"""
Golden Hour — личный кабинет ученика (LAN / общий Wi‑Fi).
Только: дневной план + чат с Золотым часом.

  python student_portal_backend.py --host 0.0.0.0 --port 18791
  .\\start_student_portal.ps1
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

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
PORTAL_FILE = "portal.json"
PORTAL_UI_VERSION = "4"
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


def _message_text(msg: dict) -> str:
    m = msg.get("message") or msg
    content = m.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and block.get("text"):
                parts.append(str(block["text"]))
        return "\n".join(parts).strip()
    return (m.get("text") or "").strip()


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
            return {"ok": False, "error": (proc.stderr or "empty agent output").strip()}
        data = json.loads(raw)
        if data.get("status") != "ok":
            return {"ok": False, "error": data.get("summary") or data.get("error") or "agent failed"}
        payloads = ((data.get("result") or {}).get("payloads")) or []
        texts = [p.get("text", "").strip() for p in payloads if p.get("text")]
        reply = "\n\n".join(t for t in texts if t)
        return {"ok": True, "reply": reply, "runId": data.get("runId")}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "agent timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def run_chat_rpc(cmd: str, session_key: str, **kwargs) -> dict:
    if cmd == "history":
        msgs = read_session_history(session_key, int(kwargs.get("limit", 40)))
        return {"ok": True, "messages": msgs}
    if cmd == "send":
        return run_agent_turn(session_key, kwargs.get("message", ""))
    return {"ok": False, "error": "unknown rpc"}


def plan_to_active_pool(plan: dict | None, day: str) -> dict:
    tasks_out: list[dict] = []
    for t in (plan or {}).get("tasks") or []:
        sched = str(t.get("scheduled_at") or "")
        due = sched[:10] if len(sched) >= 10 else day
        tasks_out.append(
            {
                "id": str(t.get("id") or f"plan-{len(tasks_out) + 1}"),
                "title": t.get("title") or "—",
                "status": str(t.get("status") or "planned").lower(),
                "agent": "user",
                "priority": "medium",
                "due_date": due,
                "scheduled_at": sched,
                "created_at": sched or f"{day}T12:00:00",
                "updated_at": sched or f"{day}T12:00:00",
                "source": "daily-plan",
            }
        )
    return {"version": "1.0", "tasks": tasks_out, "updated_at": day}


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


def plan_task_to_pool_row(task: dict, day: str) -> dict:
    sched = str(task.get("scheduled_at") or "")
    due = sched[:10] if len(sched) >= 10 else day
    return {
        "id": str(task.get("id") or ""),
        "title": task.get("title") or "—",
        "status": str(task.get("status") or "planned").lower(),
        "agent": "user",
        "priority": "medium",
        "due_date": due,
        "scheduled_at": sched,
        "created_at": sched or f"{day}T12:00:00",
        "updated_at": sched or f"{day}T12:00:00",
        "source": "daily-plan",
    }


def update_plan_task_status(user_dir: Path, day: str, task_id: str, raw_status: str) -> dict:
    plan = load_daily_plan(user_dir, day)
    if not plan:
        return {"ok": False, "error": "no_plan"}
    status = kanban_status_to_plan(raw_status)
    if status not in STUDENT_PLAN_STATUSES:
        return {"ok": False, "error": "status_not_allowed"}
    tasks = plan.get("tasks") or []
    idx = next((i for i, t in enumerate(tasks) if str(t.get("id")) == str(task_id)), None)
    if idx is None:
        return {"ok": False, "error": "task_not_found"}
    task = dict(tasks[idx])
    task["status"] = status
    if status != "snoozed":
        task.pop("snoozed_until", None)
    tasks[idx] = task
    plan["tasks"] = tasks
    plan_path = user_dir / "plans" / f"{day}.json"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "task": plan_task_to_pool_row(task, day)}


def build_felpik_snapshot(token: str, *, partial: bool = False) -> dict | None:
    hit = find_user_by_token(token)
    if not hit:
        return None
    user_dir: Path = hit["dir"]
    day = today_iso()
    plan = load_daily_plan(user_dir, day)
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
        "active_pool": plan_to_active_pool(plan, day),
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
    inject = (
        f'<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
        f'<meta name="portal-ui-version" content="{PORTAL_UI_VERSION}">\n'
        f'<!-- portal-ui-v{PORTAL_UI_VERSION} felpik-dashboard -->\n'
        f'<script>window.FELPIK_STUDENT={{enabled:true,token:{json.dumps(token)},uiVersion:{json.dumps(PORTAL_UI_VERSION)}}};'
        'document.documentElement.dataset.student="1";</script>\n'
        '<style id="felpik-student-shell">'
        "html[data-student=\"1\"] .btn-add-task,#btn-add-task-cal,#kanban-filter-btn,.global-search,"
        "#poll-sel,#btn-refresh,.squad-search,.side-link[data-goto=\"crons\"],"
        "#nav-rail button[data-goto]:not([data-goto=\"tasks\"]):not([data-goto=\"calendar\"]):not([data-goto=\"chat\"]),"
        ".kb-edit-btn,.kb-col-add,.kb-col-new,.kb-col-del,.cal-week-goal-add,.cal-week-add,.cal-goal-del,.cal-day-add,"
        ".kpi-footer,#rel-bar,.url-hint,#chat-agent,.chat-toolbar label[for=\"chat-agent\"]{display:none!important}"
        "</style>\n"
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

        if path in ("/", "/student", "/student-portal.html", "/student-felpik.html", "/dashboard.html"):
            self._send(200, LANDING_HTML.encode("utf-8"), "text/html; charset=utf-8")
            return

        if path == "/gateway-chat.js":
            if GATEWAY_CHAT_JS.exists():
                self._send(200, GATEWAY_CHAT_JS.read_bytes(), "application/javascript; charset=utf-8")
            else:
                self._send(404, b"gateway-chat.js not found", "text/plain; charset=utf-8")
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

        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()
        if body is None:
            self._send(400, b"invalid json", "text/plain; charset=utf-8")
            return

        token = body.get("token") or ""
        qs = parse_qs(parsed.query)
        token = token or (qs.get("token") or [""])[0]

        if path == "/api/tasks":
            self._send(403, b"read-only student portal", "text/plain; charset=utf-8")
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
        if raw_status is None or str(raw_status).strip() == "":
            self._send(400, b"status required", "text/plain; charset=utf-8")
            return
        day = str(body.get("date") or today_iso())
        result = update_plan_task_status(hit["dir"], day, task_id, str(raw_status))
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
