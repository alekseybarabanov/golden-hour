"""
Golden Hour — личный кабинет ученика (LAN / общий Wi‑Fi).
Только: дневной план + чат с Золотым часом.

  python student_portal_backend.py --host 0.0.0.0 --port 18791
  .\\start_student_portal.ps1
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import subprocess
import sys
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, parse_qsl, unquote, urlparse

if sys.platform == "win32":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
    sys.stderr = open(sys.stderr.fileno(), mode="w", encoding="utf-8", buffering=1)


def _resolve_openclaw_home() -> Path:
    env = os.environ.get("OPENCLAW_HOME", "").strip()
    if env:
        return Path(env).expanduser()
    return Path.home() / ".openclaw"


OPENCLAW_HOME = _resolve_openclaw_home()
OPENCLAW_JSON = OPENCLAW_HOME / "openclaw.json"
DASHBOARD_DIR = Path(__file__).parent
ADMIN_DASHBOARD = DASHBOARD_DIR / "dashboard.html"
GATEWAY_CHAT_JS = DASHBOARD_DIR / "gateway-chat.js"
TELEGRAM_MINIAPP_JS = DASHBOARD_DIR / "telegram-miniapp.js"
TELEGRAM_MINIAPP_CSS = DASHBOARD_DIR / "telegram-miniapp.css"
MINIAPP_BOOT = (
    '<script>document.documentElement.classList.add("tg-miniapp");'
    'document.documentElement.dataset.student="1";'
    'document.documentElement.dataset.ghStudentMiniapp="1";'
    'sessionStorage.setItem("tg_miniapp","1");</script>'
    '<link rel="stylesheet" href="/telegram-miniapp.css">'
    '<script src="/telegram-miniapp.js" defer></script>'
)
PORTAL_FILE = "portal.json"
PORTAL_UI_VERSION = "5"
STUDENT_PORT = 18791

LANDING_HTML = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<title>Золотой час</title>
<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.box{max-width:420px} code{background:#151b24;padding:2px 8px;border-radius:6px}</style>
</head><body><div class="box">
<h1>Личный кабинет</h1>
<p>Нужна персональная ссылка из Telegram-бота.</p>
<p>Напиши боту: <code>/web</code></p>
<p style="color:#8b949e;font-size:13px">UI v""" + PORTAL_UI_VERSION + """ · Felpik dashboard</p>
</div></body></html>"""
AGENTS_SESSIONS = OPENCLAW_HOME / "agents" / "golden-hour" / "sessions" / "sessions.json"


def resolve_openclaw_cmd() -> str:
    env = os.environ.get("OPENCLAW_CLI", "").strip()
    if env and Path(env).expanduser().exists():
        return str(Path(env).expanduser())
    for candidate in (
        Path.home() / "AppData" / "Roaming" / "npm" / "openclaw.cmd",
        Path.home() / "AppData" / "Roaming" / "npm" / "openclaw",
    ):
        if candidate.exists():
            return str(candidate)
    return "openclaw"


def _read_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def golden_hour_workspace() -> Path:
    cfg = _read_json(OPENCLAW_JSON) or {}
    for agent in (cfg.get("agents") or {}).get("list") or []:
        if agent.get("id") == "golden-hour" and agent.get("workspace"):
            return Path(agent["workspace"]).expanduser()
    return OPENCLAW_HOME / "workspaces" / "golden-hour"


GH_WORKSPACE = golden_hour_workspace()


def detect_lan_ip() -> str:
    env = os.environ.get("GH_STUDENT_PORTAL_HOST", "").strip()
    if env:
        return env
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def _read_env_file() -> dict[str, str]:
    out: dict[str, str] = {}
    env_path = OPENCLAW_HOME / ".env"
    if not env_path.exists():
        return out
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _load_secrets_telegram_token(agent: str = "golden-hour") -> str:
    secrets_path = OPENCLAW_HOME / "secrets.json"
    if not secrets_path.exists():
        return ""
    try:
        data = json.loads(secrets_path.read_text(encoding="utf-8"))
        tg = (data.get("channels") or {}).get("telegram") or {}
        if agent == "golden-hour":
            gh = tg.get("golden-hour") or {}
            return str(gh.get("botToken") or "").strip()
        return str(tg.get("botToken") or "").strip()
    except Exception:
        return ""


def _load_golden_hour_bot_token() -> str:
    for key in ("TELEGRAM_GOLDEN_HOUR_BOT_TOKEN", "TELEGRAM_STUDENT_MINIAPP_BOT_TOKEN", "TELEGRAM_MINIAPP_BOT_TOKEN"):
        v = os.environ.get(key, "").strip()
        if v:
            return v
    env = _read_env_file()
    for key in ("TELEGRAM_GOLDEN_HOUR_BOT_TOKEN", "TELEGRAM_STUDENT_MINIAPP_BOT_TOKEN", "TELEGRAM_MINIAPP_BOT_TOKEN"):
        v = env.get(key, "").strip()
        if v:
            return v
    return _load_secrets_telegram_token("golden-hour")


def validate_telegram_init_data(init_data: str, bot_token: str) -> dict | None:
    init_data = str(init_data or "").strip()
    bot_token = str(bot_token or "").strip()
    if not init_data or not bot_token:
        return None
    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    computed = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if computed != received_hash:
        return None
    user_raw = parsed.get("user") or "{}"
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError:
        user = {}
    return {
        "user": user,
        "auth_date": parsed.get("auth_date"),
        "query_id": parsed.get("query_id"),
    }


def telegram_miniapp_config() -> dict:
    public_url = os.environ.get("TELEGRAM_MINIAPP_URL", "").strip().rstrip("/")
    if not public_url:
        public_url = _read_env_file().get("TELEGRAM_MINIAPP_URL", "").strip().rstrip("/")
    return {
        "hasBotToken": bool(_load_golden_hour_bot_token()),
        "publicUrl": public_url,
        "miniappPath": "/miniapp",
        "studentMode": True,
        "agent": "golden-hour",
    }


def _strip_md_value(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ('"', "'"):
        return raw[1:-1]
    return raw


def parse_profile_field(profile_path: Path, field: str) -> str:
    if not profile_path.exists():
        return ""
    text = profile_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        stripped = line.strip()
        m = re.match(rf"^-\s+\*\*{re.escape(field)}:\*\*\s+(.+)$", stripped)
        if m:
            return _strip_md_value(m.group(1).strip())
        m = re.match(rf"^{re.escape(field)}:\s*(.+)$", stripped, re.IGNORECASE)
        if m:
            return _strip_md_value(m.group(1).strip())
    return ""


def parse_profile_list_field(profile_path: Path, field: str) -> list[str]:
    if not profile_path.exists():
        return []
    lines = profile_path.read_text(encoding="utf-8", errors="replace").splitlines()
    out: list[str] = []
    collecting_nested = False
    header_indent = 0
    for line in lines:
        stripped = line.strip()
        if re.match(rf"^-\s+\*\*{re.escape(field)}:\*\*\s*(.*)$", stripped):
            m = re.match(rf"^-\s+\*\*{re.escape(field)}:\*\*\s*(.*)$", stripped)
            val = _strip_md_value((m.group(1) if m else "").strip())
            if val.startswith("[") and val.endswith("]"):
                inner = val[1:-1].strip()
                if inner:
                    out.extend(_strip_md_value(x.strip()) for x in inner.split(",") if x.strip())
                collecting_nested = False
            elif val:
                out.append(val)
                collecting_nested = False
            else:
                collecting_nested = True
                header_indent = len(line) - len(line.lstrip(" "))
            continue
        if collecting_nested:
            if not stripped:
                continue
            indent = len(line) - len(line.lstrip(" "))
            if indent <= header_indent and stripped.startswith("- "):
                collecting_nested = False
                continue
            if indent > header_indent and stripped.startswith("- "):
                out.append(_strip_md_value(stripped[2:].strip()))
                continue
            if indent <= header_indent:
                collecting_nested = False
    return out


def parse_progress_streak(progress_path: Path) -> int:
    if not progress_path.exists():
        return 0
    m = re.search(r"\*\*Streak:\*\*\s*(\d+)", progress_path.read_text(encoding="utf-8", errors="replace"))
    return int(m.group(1)) if m else 0


def user_dir_for_key(user_key: str) -> Path | None:
    if not user_key or ".." in user_key or "/" in user_key:
        return None
    p = GH_WORKSPACE / "users" / user_key
    return p if p.is_dir() else None


def find_user_by_telegram_id(tg_id: int | str) -> dict | None:
    try:
        tid = int(tg_id)
    except (TypeError, ValueError):
        return None
    user_key = f"tg-{tid}"
    user_dir = user_dir_for_key(user_key)
    if not user_dir:
        return None
    return {"user_key": user_key, "dir": user_dir}


def ensure_portal_token(user_dir: Path) -> str:
    portal_path = user_dir / PORTAL_FILE
    data = _read_json(portal_path)
    if data and data.get("token"):
        return str(data["token"])
    token = secrets.token_urlsafe(24)
    now = datetime.now().isoformat()
    payload = {
        "token": token,
        "created": now[:10],
        "rotated_at": None,
        "source": "telegram-miniapp",
    }
    portal_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return token


def resolve_student_from_telegram(tg_user: dict) -> dict:
    tg_id = tg_user.get("id")
    hit = find_user_by_telegram_id(tg_id)
    if not hit:
        return {
            "ok": False,
            "error": "user_not_found",
            "message": "Профиль не найден. Напиши боту /start и пройди настройку.",
        }
    user_dir: Path = hit["dir"]
    profile_path = user_dir / "profile.md"
    setup_status = parse_profile_field(profile_path, "setup_status") or "incomplete"
    name = parse_profile_name(profile_path)
    token = ensure_portal_token(user_dir)
    session_key = session_key_for_user(hit["user_key"])
    return {
        "ok": True,
        "student": True,
        "token": token,
        "user_key": hit["user_key"],
        "name": name,
        "setup_complete": setup_status == "complete",
        "setup_status": setup_status,
        "session_key": session_key,
        "user": tg_user,
    }


def build_student_profile_data(user_dir: Path, user_key: str) -> dict:
    profile_path = user_dir / "profile.md"
    progress_path = user_dir / "progress.md"
    day = today_iso()
    plan = load_daily_plan(user_dir, day)
    tasks = (plan or {}).get("tasks") or []
    goals = (plan or {}).get("goals") or []
    done = sum(1 for t in tasks if str(t.get("status") or "").lower() in ("done", "completed", "ok", "success"))
    in_progress = sum(
        1
        for t in tasks
        if str(t.get("status") or "").lower() in ("in_progress", "running", "active", "working")
    )
    total_items = len(tasks) + len(goals)
    timer = _read_json(user_dir / "timer" / "stats.json") or {}
    work_today = 0
    if isinstance(timer.get("total_work_minutes_by_date"), dict):
        work_today = int(timer["total_work_minutes_by_date"].get(day) or 0)
    return {
        "ok": True,
        "user_key": user_key,
        "name": parse_profile_name(profile_path),
        "setup_status": parse_profile_field(profile_path, "setup_status") or "incomplete",
        "grade": parse_profile_field(profile_path, "grade"),
        "purpose": parse_profile_field(profile_path, "purpose"),
        "purposes": parse_profile_list_field(profile_path, "purposes"),
        "exam_type": parse_profile_field(profile_path, "exam_type"),
        "exam_subjects": parse_profile_list_field(profile_path, "exam_subjects"),
        "olympiad_subjects": parse_profile_list_field(profile_path, "olympiad_subjects"),
        "streak_days": parse_progress_streak(progress_path),
        "today": {
            "date": day,
            "total_tasks": total_items,
            "done": done,
            "in_progress": in_progress,
            "planned": max(0, len(tasks) - done - in_progress),
            "goals": len(goals),
        },
        "timer": {
            "work_minutes_today": work_today,
            "work_minutes_all_time": int(timer.get("total_work_minutes_all_time") or 0),
            "cycles_all_time": int(timer.get("total_cycles_all_time") or 0),
        },
        "session_key": session_key_for_user(user_key),
    }


def student_shell_css() -> str:
    return """
html[data-student="1"] header.top .brand{font-size:0}
html[data-student="1"] header.top .brand::after{content:"🌅 Golden hour";font-size:14px;font-weight:700;letter-spacing:.2px}
html[data-student="1"] header.top::after{content:"FelpikUI";margin-left:auto;color:var(--fg-2);font-size:12px;font-weight:700;letter-spacing:.4px}
html[data-student="1"] header.top .meta,
html[data-student="1"] #poll-sel,
html[data-student="1"] #btn-refresh,
html[data-student="1"] #btn-add-task,
html[data-student="1"] #btn-add-task-cal,
html[data-student="1"] .url-hint,
html[data-student="1"] #conn-banner,
html[data-student="1"] .kpi-footer,
html[data-student="1"] #rel-bar,
html[data-student="1"] .sidebar-wrap,
html[data-student="1"] .global-search,
html[data-student="1"] .squad-search,
html[data-student="1"] #chat-agent,
html[data-student="1"] .chat-toolbar label[for="chat-agent"],
html[data-student="1"] #kanban-filter-btn,
html[data-student="1"] #tg-btn-add,
html[data-student="1"] .kb-col-add,
html[data-student="1"] .kb-col-new,
html[data-student="1"] .kb-col-del,
html[data-student="1"] .cal-week-goal-add,
html[data-student="1"] .cal-week-add,
html[data-student="1"] .cal-goal-del,
html[data-student="1"] .cal-day-add,
html[data-student="1"] #view-inbox,
html[data-student="1"] #kb-col-modal-overlay,
html[data-student="1"] .kb-col[data-col="batch"],
html[data-student="1"] .kb-col[data-col="approval"],
html[data-student="1"] [data-tab="inbox"],
html[data-student="1"] [data-goto="inbox"],
html[data-student="1"] .tabs button:not([data-tab="tasks"]):not([data-tab="calendar"]):not([data-tab="chat"]),
html[data-student="1"] #nav-rail button[data-goto]:not([data-goto="tasks"]):not([data-goto="calendar"]):not([data-goto="chat"]){
  display:none!important;
}
html[data-student="1"] .app-main{margin-left:0}
html[data-student="1"] .tabs{gap:8px}
html[data-student="1"] .tabs button{font-weight:700}
""".strip()


def serve_student_miniapp(base_path: str = "") -> bytes:
    html = ADMIN_DASHBOARD.read_text(encoding="utf-8")
    prefix = (base_path or "").rstrip("/")
    inject = (
        f'<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
        f'<meta name="portal-ui-version" content="{PORTAL_UI_VERSION}">\n'
        f'<!-- gh-student-miniapp-v{PORTAL_UI_VERSION} -->\n'
        f'<script>window.FELPIK_API_PREFIX={json.dumps(prefix)};'
        f'window.FELPIK_STUDENT={{enabled:true,telegramMiniapp:true,uiVersion:{json.dumps(PORTAL_UI_VERSION)}}};</script>\n'
        f"<style id=\"felpik-student-shell\">{student_shell_css()}</style>\n"
    )
    html = html.replace("<head>", f"<head>\n{inject}\n{MINIAPP_BOOT}", 1)
    if prefix:
        html = html.replace('href="/telegram-miniapp.css"', f'href="{prefix}/telegram-miniapp.css"')
        html = html.replace('src="/telegram-miniapp.js"', f'src="{prefix}/telegram-miniapp.js"')
    return html.encode("utf-8")


def find_user_by_token(token: str) -> dict | None:
    if not token or len(token) < 16 or ".." in token or "/" in token:
        return None
    users_root = GH_WORKSPACE / "users"
    if not users_root.is_dir():
        return None
    for entry in users_root.iterdir():
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        portal_path = entry / PORTAL_FILE
        if not portal_path.is_file():
            continue
        data = _read_json(portal_path)
        if data and data.get("token") == token:
            return {"user_key": entry.name, "portal": data, "dir": entry}
    return None


def session_key_for_user(user_key: str) -> str:
    m = re.fullmatch(r"tg-(\d+)", user_key)
    if m:
        return f"agent:golden-hour:telegram:direct:{m.group(1)}"
    return "agent:golden-hour:main"


def parse_profile_name(profile_path: Path) -> str:
    if not profile_path.exists():
        return "Ученик"
    text = profile_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        m = re.match(r"^-\s+\*\*name:\*\*\s+(.+)$", line.strip())
        if m:
            raw = m.group(1).strip()
            if raw.startswith('"') and raw.endswith('"'):
                return raw[1:-1]
            return raw
    return "Ученик"


def today_iso() -> str:
    return date.today().isoformat()


def load_daily_plan(user_dir: Path, day: str | None = None) -> dict | None:
    d = day or today_iso()
    plan_path = user_dir / "plans" / f"{d}.json"
    return _read_json(plan_path)


def write_daily_plan(user_dir: Path, day: str, plan: dict) -> None:
    plan_path = user_dir / "plans" / f"{day}.json"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def expire_past_plan_tasks(user_dir: Path, today: str) -> None:
    plans_dir = user_dir / "plans"
    if not plans_dir.is_dir():
        return
    now = datetime.now().isoformat(timespec="seconds")
    done_statuses = {"done", "completed", "ok", "success"}
    abandoned_statuses = {"skipped", "failed", "cancelled", "canceled", "archived", "blocked", "error"}
    for plan_path in sorted(plans_dir.glob("*.json")):
        day = plan_path.stem[:10]
        if day.startswith("."):
            continue
        plan = load_daily_plan(user_dir, day)
        if not isinstance(plan, dict):
            continue
        changed = False
        for section in ("tasks", "goals"):
            items = plan.get(section)
            if not isinstance(items, list):
                continue
            for task in items:
                if not isinstance(task, dict):
                    continue
                sched = str(task.get("scheduled_at") or "")
                due = sched[:10] if len(sched) >= 10 else day
                status = str(task.get("status") or "planned").strip().lower()
                if due < today and status not in done_statuses and status not in abandoned_statuses:
                    task["status"] = "skipped"
                    task["updated_at"] = now
                    if section == "goals":
                        task["kind"] = "goal"
                    changed = True
        if changed:
            write_daily_plan(user_dir, day, plan)


def empty_daily_plan(user_key: str, day: str) -> dict:
    return {
        "date": day,
        "user_id": user_key,
        "goals": [],
        "tasks": [],
        "load": {"sum_difficulty": 0, "budget": 0},
        "meta": {
            "generated_by": "student-dashboard",
            "topic": "",
            "purposes": [],
        },
    }


def next_plan_task_id(tasks: list[dict]) -> str:
    max_num = 0
    for task in tasks:
        m = re.fullmatch(r"t_(\d+)", str(task.get("id") or ""))
        if m:
            max_num = max(max_num, int(m.group(1)))
    return f"t_{max_num + 1:03d}"


def find_plan_item(user_dir: Path, preferred_day: str, task_id: str) -> tuple[str, dict, str, int] | None:
    raw_task_id = str(task_id or "")
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})::(.+)", raw_task_id)
    if m:
        preferred_day = m.group(1)
        task_id = m.group(2)
    days: list[str] = []
    if preferred_day:
        days.append(str(preferred_day)[:10])
    today = today_iso()
    if today not in days:
        days.append(today)

    plans_dir = user_dir / "plans"
    if plans_dir.is_dir():
        for p in sorted(plans_dir.glob("*.json"), reverse=True):
            day = p.stem
            if day.startswith(".") or day in days:
                continue
            days.append(day)

    for day in days:
        plan = load_daily_plan(user_dir, day)
        if not plan:
            continue
        for section in ("tasks", "goals"):
            items = plan.get(section) or []
            idx = next((i for i, t in enumerate(items) if str(t.get("id")) == str(task_id)), None)
            if idx is not None:
                return day, plan, section, idx
    return None


def session_file_for_key(session_key: str) -> Path | None:
    data = _read_json(AGENTS_SESSIONS)
    if not data:
        return None
    entry = data.get(session_key) or {}
    sf = entry.get("sessionFile") or (entry.get("origin") or {}).get("sessionFile")
    if sf:
        p = Path(sf)
        if p.is_file():
            return p
    return None


def _is_thinking_text(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    low = t.lower()
    if low in ("/think", "think", "<think>", "</think>"):
        return True
    return False


def _message_text(msg: dict) -> str:
    m = msg.get("message") or msg
    content = m.get("content")
    if isinstance(content, str):
        text = content.strip()
        return "" if _is_thinking_text(text) else text
    if isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "thinking":
                continue
            if block.get("type") == "text":
                text = str(block.get("text") or "").strip()
                if text and not _is_thinking_text(text):
                    parts.append(text)
        return "\n".join(parts).strip()
    text = (m.get("text") or "").strip()
    return "" if _is_thinking_text(text) else text


def sanitize_chat_reply(text: str) -> str:
    lines = [ln.strip() for ln in str(text or "").splitlines()]
    kept = [ln for ln in lines if ln and not _is_thinking_text(ln)]
    return "\n".join(kept).strip()


def read_session_history(session_key: str, limit: int = 40) -> list[dict]:
    path = session_file_for_key(session_key)
    if not path:
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    out: list[dict] = []
    for raw in lines[-400:]:
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if row.get("type") != "message":
            continue
        m = row.get("message") or {}
        role = (m.get("role") or "").lower()
        if role not in ("user", "assistant"):
            continue
        text = _message_text(row)
        if not text or role == "assistant" and text.startswith("{"):
            continue
        out.append({"role": role, "text": text, "ts": row.get("timestamp")})
    return out[-limit:]


def run_agent_turn(session_key: str, message: str) -> dict:
    cmd = resolve_openclaw_cmd()
    try:
        proc = subprocess.run(
            [cmd, "agent", "--session-key", session_key, "-m", message, "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=180,
        )
        raw = (proc.stdout or "").strip()
        if not raw:
            return {"ok": False, "error": sanitize_chat_error((proc.stderr or "empty agent output").strip())}
        data = json.loads(raw)
        if data.get("status") != "ok":
            return {"ok": False, "error": sanitize_chat_error(data.get("summary") or data.get("error") or "agent failed")}
        payloads = ((data.get("result") or {}).get("payloads")) or []
        texts = [p.get("text", "").strip() for p in payloads if p.get("text")]
        reply = sanitize_chat_reply("\n\n".join(t for t in texts if t))
        return {"ok": True, "reply": reply, "runId": data.get("runId")}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "agent timeout"}
    except Exception as e:
        return {"ok": False, "error": sanitize_chat_error(str(e))}


def sanitize_chat_error(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return "agent failed"
    low = text.lower()
    if "<!doctype html" in low or "<html" in low or "cloudflare" in low or "bad gateway" in low or "error code 502" in low:
        return "Портал или туннель только что перезапускался. Подождите несколько секунд и отправьте сообщение ещё раз."
    return text[:500] + ("..." if len(text) > 500 else "")


def run_chat_rpc(cmd: str, session_key: str, **kwargs) -> dict:
    if cmd == "history":
        msgs = read_session_history(session_key, int(kwargs.get("limit", 40)))
        return {"ok": True, "messages": msgs}
    if cmd == "send":
        return run_agent_turn(session_key, kwargs.get("message", ""))
    return {"ok": False, "error": "unknown rpc"}


def plan_to_active_pool(plan: dict | None, day: str) -> dict:
    tasks_out: list[dict] = []
    for g in (plan or {}).get("goals") or []:
        raw_id = str(g.get("id") or f"goal-{len(tasks_out) + 1}")
        tasks_out.append(
            {
                "id": f"{day}::{raw_id}",
                "plan_task_id": raw_id,
                "title": g.get("title") or "—",
                "status": str(g.get("status") or "planned").lower(),
                "agent": "user",
                "priority": str(g.get("priority") or "medium").lower(),
                "difficulty": int(g.get("difficulty") or g.get("weight") or 2),
                "due_date": day,
                "scheduled_at": f"{day}T08:00:00",
                "created_at": f"{day}T08:00:00",
                "updated_at": f"{day}T08:00:00",
                "source": "daily-goal",
                "kind": "goal",
                "description": str(g.get("description") or "").strip(),
                "tag": str(g.get("tag") or "").strip().lower(),
            }
        )
    for t in (plan or {}).get("tasks") or []:
        sched = str(t.get("scheduled_at") or "")
        due = sched[:10] if len(sched) >= 10 else day
        raw_id = str(t.get("id") or "")
        tasks_out.append(
            {
                "id": f"{day}::{raw_id}" if raw_id else f"{day}::plan-{len(tasks_out) + 1}",
                "title": t.get("title") or "—",
                "status": str(t.get("status") or "planned").lower(),
                "agent": "user",
                "priority": str(t.get("priority") or "medium").lower(),
                "difficulty": int(t.get("difficulty") or t.get("weight") or 2),
                "due_date": due,
                "scheduled_at": sched,
                "created_at": sched or f"{day}T12:00:00",
                "updated_at": sched or f"{day}T12:00:00",
                "source": "daily-plan",
                "description": str(t.get("description") or "").strip(),
                "tag": str(t.get("tag") or "").strip().lower(),
            }
        )
    return {"version": "1.0", "tasks": tasks_out, "updated_at": day}


def all_daily_plans_to_active_pool(user_dir: Path, fallback_day: str) -> dict:
    expire_past_plan_tasks(user_dir, fallback_day)
    plans_dir = user_dir / "plans"
    days: list[str] = []
    if plans_dir.is_dir():
        for plan_path in sorted(plans_dir.glob("*.json")):
            if plan_path.stem.startswith("."):
                continue
            days.append(plan_path.stem[:10])
    if fallback_day not in days:
        days.append(fallback_day)

    tasks_out: list[dict] = []
    for day in sorted(set(days)):
        plan = load_daily_plan(user_dir, day)
        pool = plan_to_active_pool(plan, day)
        tasks_out.extend(pool.get("tasks") or [])
    return {"version": "1.0", "tasks": tasks_out, "updated_at": fallback_day}


STUDENT_PLAN_STATUSES = frozenset({"planned", "in_progress", "done", "skipped"})


def kanban_status_to_plan(raw: str) -> str:
    s = str(raw or "").strip().lower()
    mapping = {
        "pending": "planned",
        "queued": "planned",
        "todo": "planned",
        "new": "planned",
        "planned": "planned",
        "batch": "planned",
        "approval": "planned",
        "in_progress": "in_progress",
        "running": "in_progress",
        "active": "in_progress",
        "working": "in_progress",
        "done": "done",
        "completed": "done",
        "ok": "done",
        "success": "done",
        "failed": "skipped",
        "skipped": "skipped",
        "cancelled": "skipped",
        "canceled": "skipped",
        "blocked": "skipped",
        "archived": "skipped",
        "error": "skipped",
    }
    out = mapping.get(s, s)
    return out if out in STUDENT_PLAN_STATUSES else "planned"


def abandon_confirmed(payload: dict | None) -> bool:
    if not isinstance(payload, dict):
        return False
    for key in ("abandon_confirmed", "abandoned_confirmed", "confirm_abandoned"):
        raw = payload.get(key)
        if raw is True:
            return True
        if isinstance(raw, str) and raw.strip().lower() in ("1", "true", "yes", "y", "да", "confirmed"):
            return True
    return False


def validate_student_status_transition(current_status: str, next_status: str, payload: dict | None = None) -> dict | None:
    current = kanban_status_to_plan(current_status)
    next_ = kanban_status_to_plan(next_status)
    if current == "skipped" and next_ != "skipped":
        return {"ok": False, "error": "abandoned_task_locked"}
    if current != "skipped" and next_ == "skipped" and not abandon_confirmed(payload):
        return {"ok": False, "error": "abandon_confirmation_required"}
    return None


def plan_item_due_date(task: dict, fallback_day: str) -> str:
    sched = str(task.get("scheduled_at") or "")
    return sched[:10] if len(sched) >= 10 else str(fallback_day)[:10]


def plan_task_to_pool_row(task: dict, day: str) -> dict:
    sched = str(task.get("scheduled_at") or "")
    due = plan_item_due_date(task, day)
    raw_id = str(task.get("id") or "")
    return {
        "id": f"{day}::{raw_id}" if raw_id else "",
        "plan_task_id": raw_id,
        "title": task.get("title") or "—",
        "status": str(task.get("status") or "planned").lower(),
        "agent": "user",
        "priority": str(task.get("priority") or "medium").lower(),
        "difficulty": int(task.get("difficulty") or task.get("weight") or 2),
        "due_date": due,
        "scheduled_at": sched,
        "created_at": sched or f"{day}T12:00:00",
        "updated_at": sched or f"{day}T12:00:00",
        "source": "daily-plan",
        "kind": task.get("kind") or ("goal" if str(task.get("id") or "").startswith("g_") else "task"),
        "description": str(task.get("description") or "").strip(),
        "tag": str(task.get("tag") or "").strip().lower(),
    }


def update_plan_task_status(user_dir: Path, day: str, task_id: str, raw_status: str, payload: dict | None = None) -> dict:
    found = find_plan_item(user_dir, day, task_id)
    if not found:
        return {"ok": False, "error": "task_not_found"}
    found_day, plan, section, idx = found
    status = kanban_status_to_plan(raw_status)
    if status not in STUDENT_PLAN_STATUSES:
        return {"ok": False, "error": "status_not_allowed"}
    items = plan.get(section) or []
    task = dict(items[idx])
    if plan_item_due_date(task, found_day) < today_iso():
        return {"ok": False, "error": "past_day_status_locked"}
    transition_error = validate_student_status_transition(str(task.get("status") or "planned"), status, payload)
    if transition_error:
        return transition_error
    task["status"] = status
    if section == "goals":
        task["kind"] = "goal"
    if status != "snoozed":
        task.pop("snoozed_until", None)
    items[idx] = task
    plan[section] = items
    write_daily_plan(user_dir, found_day, plan)
    return {"ok": True, "task": plan_task_to_pool_row(task, found_day), "date": found_day}


def create_plan_task(user_dir: Path, user_key: str, payload: dict) -> dict:
    day = str(payload.get("date") or payload.get("due_date") or today_iso())[:10]
    title = str(payload.get("title") or "").strip()
    if not title:
        return {"ok": False, "error": "title_required"}
    plan = load_daily_plan(user_dir, day) or empty_daily_plan(user_key, day)
    tasks = plan.get("tasks")
    if not isinstance(tasks, list):
        tasks = []
    now = datetime.now().isoformat(timespec="seconds")
    due_date = str(payload.get("due_date") or day)[:10]
    status = kanban_status_to_plan(str(payload.get("status") or "planned"))
    task = {
        "id": next_plan_task_id(tasks),
        "goal_id": str(payload.get("goal_id") or "dashboard"),
        "title": title,
        "description": str(payload.get("description") or "").strip(),
        "scheduled_at": str(payload.get("scheduled_at") or f"{due_date}T12:00:00"),
        "est_minutes": int(payload.get("est_minutes") or 30),
        "weight": int(payload.get("weight") or 3),
        "goal_weight": int(payload.get("goal_weight") or payload.get("weight") or 3),
        "difficulty": int(payload.get("difficulty") or 2),
        "status": status,
        "snoozed_until": None,
        "source": str(payload.get("source") or "dashboard"),
        "created_at": now,
        "updated_at": now,
    }
    if payload.get("tag"):
        task["tag"] = str(payload.get("tag")).strip().lower()
    if payload.get("purpose"):
        task["purpose"] = str(payload.get("purpose")).strip()
    tasks.append(task)
    plan["tasks"] = tasks
    write_daily_plan(user_dir, day, plan)
    return {"ok": True, "task": plan_task_to_pool_row(task, day), "date": day}


def update_plan_task(user_dir: Path, day: str, task_id: str, payload: dict) -> dict:
    found = find_plan_item(user_dir, day, task_id)
    if not found:
        return {"ok": False, "error": "task_not_found"}
    found_day, plan, section, idx = found
    items = plan.get(section) or []
    task = dict(items[idx])
    if plan_item_due_date(task, found_day) < today_iso():
        return {"ok": False, "error": "past_day_edit_locked"}
    locked_detail_fields = {
        "title",
        "description",
        "tag",
        "due_date",
        "scheduled_at",
        "agent",
        "goal_id",
        "purpose",
        "est_minutes",
        "weight",
        "goal_weight",
        "complexity",
    }
    if any(k in payload for k in locked_detail_fields):
        return {"ok": False, "error": "task_details_locked"}
    if payload.get("title") is not None:
        title = str(payload.get("title") or "").strip()
        if not title:
            return {"ok": False, "error": "title_required"}
        task["title"] = title
    if payload.get("description") is not None:
        task["description"] = str(payload.get("description") or "").strip()
    if payload.get("status") is not None:
        if plan_item_due_date(task, found_day) < today_iso():
            return {"ok": False, "error": "past_day_status_locked"}
        next_status = kanban_status_to_plan(str(payload.get("status")))
        transition_error = validate_student_status_transition(str(task.get("status") or "planned"), next_status, payload)
        if transition_error:
            return transition_error
        task["status"] = next_status
        if section == "goals":
            task["kind"] = "goal"
        if task["status"] != "snoozed":
            task.pop("snoozed_until", None)
    if payload.get("due_date"):
        due_date = str(payload.get("due_date"))[:10]
        raw_sched = str(task.get("scheduled_at") or "")
        time_part = raw_sched[11:19] if len(raw_sched) >= 19 else "12:00:00"
        task["scheduled_at"] = f"{due_date}T{time_part}"
    if payload.get("scheduled_at"):
        task["scheduled_at"] = str(payload.get("scheduled_at"))
    if payload.get("priority"):
        task["priority"] = str(payload.get("priority"))
    if payload.get("difficulty") is not None:
        try:
            task["difficulty"] = max(1, min(5, int(payload.get("difficulty"))))
        except Exception:
            return {"ok": False, "error": "invalid_difficulty"}
    if payload.get("tag") is not None:
        tag = str(payload.get("tag") or "").strip().lower()
        if tag:
            task["tag"] = tag
        else:
            task.pop("tag", None)
    task["updated_at"] = datetime.now().isoformat(timespec="seconds")
    items[idx] = task
    plan[section] = items
    write_daily_plan(user_dir, found_day, plan)
    return {"ok": True, "task": plan_task_to_pool_row(task, found_day), "date": found_day}


def build_felpik_snapshot(token: str, *, partial: bool = False) -> dict | None:
    hit = find_user_by_token(token)
    if not hit:
        return None
    user_dir: Path = hit["dir"]
    day = today_iso()
    name = parse_profile_name(user_dir / "profile.md")
    session_key = session_key_for_user(hit["user_key"])
    import time

    return {
        "ts": int(time.time() * 1000),
        "partial": partial,
        "fetchMs": 0,
        "student": True,
        "studentMeta": {
            "name": name,
            "date": day,
            "sessionKey": session_key,
        },
        "agents_roster": [
            {
                "id": "golden-hour",
                "name": "Золотой час",
                "emoji": "🌅",
                "model": "—",
                "workspace": str(GH_WORKSPACE),
            }
        ],
        "channel_bindings": [],
        "history": None,
        "active_pool": all_daily_plans_to_active_pool(user_dir, day),
        "costs": None,
        "portal": {"dashboard": f"http://127.0.0.1:{STUDENT_PORT}"},
        "health": {
            "ok": True,
            "agents": [{"agentId": "golden-hour", "sessions": {"count": 1}}],
        },
        "crons_all": {"jobs": []},
        "tasks_running": {"tasks": []},
        "tasks_pending": {"tasks": []},
    }


def student_bootstrap(token: str) -> dict:
    snap = build_felpik_snapshot(token, partial=True)
    if not snap:
        return {"ok": False, "error": "invalid token"}
    meta = snap["studentMeta"]
    return {
        "ok": True,
        "name": meta["name"],
        "date": meta["date"],
        "plan": load_daily_plan(find_user_by_token(token)["dir"], meta["date"]),
        "has_plan": bool(snap["active_pool"].get("tasks")),
        "session_key": meta["sessionKey"],
        "agent_name": "Золотой час",
        "agent_emoji": "🌅",
    }


def serve_student_dashboard(token: str) -> bytes:
    html = ADMIN_DASHBOARD.read_text(encoding="utf-8")
    hit = find_user_by_token(token)
    name = parse_profile_name(hit["dir"] / "profile.md") if hit else "Ученик"
    inject = (
        f'<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
        f'<meta name="portal-ui-version" content="{PORTAL_UI_VERSION}">\n'
        f'<!-- portal-ui-v{PORTAL_UI_VERSION} felpik-dashboard -->\n'
        f'<script>window.FELPIK_STUDENT={{enabled:true,token:{json.dumps(token)},name:{json.dumps(name)},uiVersion:{json.dumps(PORTAL_UI_VERSION)}}};'
        'document.documentElement.dataset.student="1";</script>\n'
        f"<style id=\"felpik-student-shell\">{student_shell_css()}</style>\n"
    )
    return html.replace("<head>", f"<head>\n{inject}", 1).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "GoldenHourStudentPortal/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status: int, body: bytes, ctype: str = "application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 65536:
            return None
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None

    def _token_from_path(self, path: str) -> str | None:
        if path.startswith("/my/"):
            tok = unquote(path[4:]).strip("/")
            return tok if tok and ".." not in tok else None
        return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path in ("/miniapp", "/miniapp.html"):
            if not ADMIN_DASHBOARD.exists():
                self._send(404, b"dashboard.html not found", "text/plain; charset=utf-8")
                return
            prefix = (qs.get("api_prefix") or [""])[0]
            self._send(200, serve_student_miniapp(prefix), "text/html; charset=utf-8")
            return

        if path in ("/", "/student", "/student-portal.html", "/student-felpik.html", "/dashboard.html"):
            self._send(200, LANDING_HTML.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/gateway-chat.js":
            if GATEWAY_CHAT_JS.exists():
                self._send(200, GATEWAY_CHAT_JS.read_bytes(), "application/javascript; charset=utf-8")
            else:
                self._send(404, b"gateway-chat.js not found", "text/plain; charset=utf-8")
            return

        if path == "/telegram-miniapp.js":
            if TELEGRAM_MINIAPP_JS.exists():
                self._send(200, TELEGRAM_MINIAPP_JS.read_bytes(), "application/javascript; charset=utf-8")
            else:
                self._send(404, b"telegram-miniapp.js not found", "text/plain; charset=utf-8")
            return

        if path == "/telegram-miniapp.css":
            if TELEGRAM_MINIAPP_CSS.exists():
                self._send(200, TELEGRAM_MINIAPP_CSS.read_bytes(), "text/css; charset=utf-8")
            else:
                self._send(404, b"telegram-miniapp.css not found", "text/plain; charset=utf-8")
            return

        token = self._token_from_path(path) or (qs.get("token") or [""])[0]
        if path.startswith("/my/") and token:
            if ADMIN_DASHBOARD.exists():
                self._send(200, serve_student_dashboard(token), "text/html; charset=utf-8")
            else:
                self._send(404, b"dashboard.html not found", "text/plain; charset=utf-8")
            return
        if path.startswith("/my/"):
            self._send(400, LANDING_HTML.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/api/health":
            self._send(200, json.dumps({"ok": True, "service": "golden-hour-student-portal"}).encode())
            return

        if path == "/api/telegram/config":
            self._send(200, json.dumps(telegram_miniapp_config(), ensure_ascii=False).encode("utf-8"))
            return

        if path == "/api/lan":
            host = self.headers.get("Host", "").split(":")[0]
            body = json.dumps(
                {"lan_ip": detect_lan_ip(), "host_header": host, "port": STUDENT_PORT},
                ensure_ascii=False,
            )
            self._send(200, body.encode("utf-8"))
            return

        if not token:
            self._send(400, b"missing token", "text/plain; charset=utf-8")
            return

        if path == "/api/bootstrap":
            snap = build_felpik_snapshot(token, partial=True)
            if not snap:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            self._send(200, json.dumps(snap, ensure_ascii=False).encode("utf-8"))
            return

        if path == "/api/snapshot":
            snap = build_felpik_snapshot(token, partial=False)
            if not snap:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            self._send(200, json.dumps(snap, ensure_ascii=False).encode("utf-8"))
            return

        if path == "/api/chat/config":
            hit = find_user_by_token(token)
            if not hit:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            body = {
                "studentMode": True,
                "hasToken": False,
                "sessionKey": session_key_for_user(hit["user_key"]),
                "userName": parse_profile_name(hit["dir"] / "profile.md"),
            }
            self._send(200, json.dumps(body, ensure_ascii=False).encode("utf-8"))
            return

        if path == "/api/plan":
            hit = find_user_by_token(token)
            if not hit:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            day = (qs.get("date") or [today_iso()])[0]
            plan = load_daily_plan(hit["dir"], day)
            self._send(
                200,
                json.dumps({"ok": True, "date": day, "plan": plan}, ensure_ascii=False).encode("utf-8"),
            )
            return

        if path == "/api/chat/history":
            hit = find_user_by_token(token)
            if not hit:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            sk = session_key_for_user(hit["user_key"])
            limit = int((qs.get("limit") or ["80"])[0])
            rpc = run_chat_rpc("history", sk, limit=limit)
            if not rpc.get("ok"):
                self._send(502, json.dumps(rpc, ensure_ascii=False).encode("utf-8"))
                return
            self._send(
                200,
                json.dumps({"ok": True, "messages": rpc.get("messages") or []}, ensure_ascii=False).encode("utf-8"),
            )
            return

        if path == "/api/student/profile":
            hit = find_user_by_token(token)
            if not hit:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            body = build_student_profile_data(hit["dir"], hit["user_key"])
            self._send(200, json.dumps(body, ensure_ascii=False).encode("utf-8"))
            return

        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()
        if body is None and path != "/api/telegram/auth":
            self._send(400, b"invalid json", "text/plain; charset=utf-8")
            return
        body = body or {}

        if path == "/api/telegram/auth":
            init_data = str(body.get("initData") or "").strip()
            bot_token = _load_golden_hour_bot_token()
            if not bot_token:
                self._send(500, json.dumps({"ok": False, "error": "no_bot_token"}).encode("utf-8"))
                return
            verified = validate_telegram_init_data(init_data, bot_token)
            if not verified:
                self._send(401, json.dumps({"ok": False, "error": "invalid_init_data"}).encode("utf-8"))
                return
            tg_user = verified.get("user") or {}
            result = resolve_student_from_telegram(tg_user)
            status = 200 if result.get("ok") else 404
            self._send(status, json.dumps(result, ensure_ascii=False).encode("utf-8"))
            return

        token = body.get("token") or ""
        qs = parse_qs(parsed.query)
        token = token or (qs.get("token") or [""])[0]

        if path == "/api/tasks":
            self._send(
                403,
                json.dumps(
                    {"ok": False, "error": "task_creation_disabled", "message": "tasks are created by the planner bot"},
                    ensure_ascii=False,
                ).encode("utf-8"),
            )
            return

        if path == "/api/chat/send":
            hit = find_user_by_token(token)
            if not hit:
                self._send(403, b"forbidden", "text/plain; charset=utf-8")
                return
            message = (body.get("message") or "").strip()
            if not message:
                self._send(400, b"empty message", "text/plain; charset=utf-8")
                return
            sk = session_key_for_user(hit["user_key"])
            rpc = run_chat_rpc("send", sk, message=message)
            status = 200 if rpc.get("ok") else 502
            body = {
                "ok": bool(rpc.get("ok")),
                "reply": rpc.get("reply"),
                "error": rpc.get("error"),
            }
            self._send(status, json.dumps(body, ensure_ascii=False).encode("utf-8"))
            return

        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_PATCH(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/tasks/"):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        body = self._read_json_body() or {}
        qs = parse_qs(parsed.query)
        token = str(body.get("token") or (qs.get("token") or [""])[0])
        hit = find_user_by_token(token)
        if not hit:
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        task_id = unquote(path[len("/api/tasks/") :]).strip()
        if not task_id or ".." in task_id:
            self._send(400, b"bad task id", "text/plain; charset=utf-8")
            return
        raw_status = body.get("status")
        day = str(body.get("date") or today_iso())
        if raw_status is not None and set(body.keys()).issubset({"token", "status", "date"}):
            result = update_plan_task_status(hit["dir"], day, task_id, str(raw_status))
        else:
            result = update_plan_task(hit["dir"], day, task_id, body)
        if not result.get("ok"):
            err = result.get("error") or "update_failed"
            code = 404 if err in ("no_plan", "task_not_found") else 400
            self._send(code, json.dumps(result, ensure_ascii=False).encode("utf-8"))
            return
        self._send(
            200,
            json.dumps({"ok": True, "task": result["task"]}, ensure_ascii=False).encode("utf-8"),
        )

    def do_DELETE(self):
        self._send(403, b"read-only student portal", "text/plain; charset=utf-8")


def main():
    global STUDENT_PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18791)
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 — доступ по Wi‑Fi")
    args = ap.parse_args()
    STUDENT_PORT = args.port

    print(f"[student-portal] UI: admin dashboard.html (student mode)")
    print(f"[student-portal] telegram miniapp: http://127.0.0.1:{args.port}/miniapp")

    lan = detect_lan_ip()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[student-portal] workspace: {GH_WORKSPACE}")
    print(f"[student-portal] listening http://{args.host}:{args.port}/")
    print(f"[student-portal] LAN: http://{lan}:{args.port}/my/<token>")
    print("[student-portal] token: node scripts/student-portal.mjs --user tg-<id>")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("[student-portal] shutdown")


if __name__ == "__main__":
    main()
