"""Watchdog for telegram_notes_bot.

Spawns the bot in a loop. If it dies, waits RESTART_DELAY seconds and starts
again. Never gives up — that's the whole point. Used for #7: "when owner_example
comes up, all sent messages should be processed" — getUpdates with
drop_pending_updates=False picks up the queue on every restart.

Before every spawn it kills any lingering bot process (Bug #2 fix) so Telegram
never sees "terminated by other getUpdates request" from a stale instance.

Run with:
    python telegram_notes_bot_watchdog.py

Logs go to telegram_notes_bot.watchdog.log next to this script (size-rotated).
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOT = HERE / "telegram_notes_bot.py"
BOT_MARKER = BOT.name  # "telegram_notes_bot.py" — never matches *_watchdog.py
LOG = HERE / "telegram_notes_bot.watchdog.log"
RESTART_DELAY = int(os.environ.get("NOTES_BOT_RESTART_DELAY", "5"))
MAX_BACKOFF = 60  # seconds; cap exponential growth
LOG_MAX_BYTES = int(os.environ.get("NOTES_BOT_LOG_MAX_BYTES", str(512 * 1024)))
# Crash-loop alerting. Token + owner chat id come from the environment (secrets),
# never from a committed config; if unset, alerting is silently skipped.
ALERT_THRESHOLD = int(os.environ.get("NOTES_BOT_ALERT_THRESHOLD", "5"))
ALERT_COOLDOWN = int(os.environ.get("NOTES_BOT_ALERT_COOLDOWN_SEC", "3600"))


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _rotate_log() -> None:
    """Size-based rotation: LOG -> LOG.1 once it grows past LOG_MAX_BYTES.

    Best-effort; any failure is swallowed so logging never breaks the loop.
    """
    try:
        if LOG.exists() and LOG.stat().st_size > LOG_MAX_BYTES:
            backup = LOG.with_suffix(LOG.suffix + ".1")
            try:
                if backup.exists():
                    backup.unlink()
            except OSError:
                pass
            LOG.replace(backup)
    except OSError:
        pass


def log(line: str) -> None:
    msg = f"{now()} {line}"
    print(msg, flush=True)
    try:
        _rotate_log()
        with LOG.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except OSError:
        pass


def _iter_python_procs():
    """Yield (pid, cmdline_str) for running processes. Best-effort, stdlib-only."""
    # Prefer psutil when available (accurate cross-platform cmdline).
    try:
        import psutil  # type: ignore

        for p in psutil.process_iter(["pid", "cmdline"]):
            try:
                cmd = " ".join(p.info.get("cmdline") or [])
            except Exception:
                continue
            yield p.info["pid"], cmd
        return
    except Exception:
        pass

    if os.name == "posix":
        try:
            out = subprocess.run(
                ["pgrep", "-fa", BOT_MARKER],
                capture_output=True, text=True, timeout=10,
            )
            for row in out.stdout.splitlines():
                row = row.strip()
                if not row:
                    continue
                pid_str, _, cmd = row.partition(" ")
                try:
                    yield int(pid_str), cmd
                except ValueError:
                    continue
        except Exception:
            return
    elif os.name == "nt":
        try:
            out = subprocess.run(
                ["wmic", "process", "where", "name like '%python%'",
                 "get", "ProcessId,CommandLine", "/format:csv"],
                capture_output=True, text=True, timeout=15,
            )
            for row in out.stdout.splitlines():
                parts = row.split(",")
                if len(parts) < 3:
                    continue
                cmd = parts[1]
                pid_str = parts[-1].strip()
                try:
                    yield int(pid_str), cmd
                except ValueError:
                    continue
        except Exception:
            return


def kill_stale_bots() -> int:
    """Kill lingering bot processes before spawning a fresh one (Bug #2).

    A process is "stale" if its command line references the bot script but is
    neither the watchdog itself nor our own PID. Best-effort: every failure is
    logged and ignored so the restart loop can never break.
    """
    me = os.getpid()
    killed = 0
    try:
        for pid, cmd in _iter_python_procs():
            if pid == me:
                continue
            if BOT_MARKER not in cmd:
                continue
            if "watchdog" in cmd:
                continue
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                                   capture_output=True, timeout=10)
                else:
                    os.kill(pid, signal.SIGTERM)
                killed += 1
                log(f"killed stale bot process pid={pid}")
            except (OSError, subprocess.SubprocessError) as exc:
                log(f"could not kill pid={pid}: {exc}")
    except Exception as exc:  # pragma: no cover - defensive
        log(f"kill_stale_bots failed: {exc}")
    if killed:
        log(f"kill_stale_bots: removed {killed} stale bot process(es)")
    return killed


def _send_owner_alert(text: str) -> None:
    """Alert the owner about a crash loop via the Telegram Bot API.

    Secrets are read from the environment ONLY — never hardcode them in the repo:
      - TEAM_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) — bot token
      - NOTES_BOT_OWNER_CHAT_ID              — owner chat id
    If either is unset, the alert is skipped (logged, not fatal). Any network or
    Telegram error is swallowed so the restart loop never breaks.
    """
    token = os.environ.get("TEAM_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("NOTES_BOT_OWNER_CHAT_ID")
    if not token or not chat_id:
        log("alert skipped: TEAM_BOT_TOKEN / NOTES_BOT_OWNER_CHAT_ID not set (secrets)")
        return
    try:
        payload = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=payload,
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        log("owner alert sent")
    except Exception as exc:  # pragma: no cover - network/telegram errors
        log(f"alert send failed: {exc}")


def main() -> int:
    log(f"watchdog start; bot={BOT}; restart_delay={RESTART_DELAY}s")
    backoff = RESTART_DELAY
    consecutive_fail = 0
    last_alert = 0.0
    while True:
        kill_stale_bots()
        log("spawning bot...")
        try:
            rc = subprocess.call([sys.executable, str(BOT)])
        except KeyboardInterrupt:
            log("watchdog: KeyboardInterrupt, exiting")
            return 0
        if rc != 0:
            consecutive_fail += 1
            log(f"bot exited with code {rc} (consecutive failures: {consecutive_fail}); "
                f"restarting in {backoff}s")
            if consecutive_fail >= ALERT_THRESHOLD and (time.time() - last_alert) > ALERT_COOLDOWN:
                _send_owner_alert(
                    f"⚠️ notes-bot watchdog: бот упал "
                    f"{consecutive_fail} раз(а) подряд "
                    f"(последний код {rc}). "
                    f"Проверь telegram_notes_bot.watchdog.log."
                )
                last_alert = time.time()
        else:
            consecutive_fail = 0
            log(f"bot exited with code 0; restarting in {backoff}s")
        time.sleep(backoff)
        backoff = min(backoff * 2, MAX_BACKOFF) if rc != 0 else RESTART_DELAY


if __name__ == "__main__":
    sys.exit(main())
