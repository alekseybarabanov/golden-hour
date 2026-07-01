# 06. Дашборд, Student Portal и Telegram Mini App

Папка `dashboard/` содержит веб-интерфейсы поверх данных агента, мониторинг и PowerShell-скрипты запуска (ориентированы на Windows-хост с Wi-Fi хотспотом). Все интерфейсы читают/пишут те же `users/<user_key>/plans/*.json`, что и агент.

## Компоненты и порты

| Компонент | Порт | Слушает | Назначение |
|---|---|---|---|
| Admin Dashboard («Фельпик») | 18790 | 127.0.0.1 или 0.0.0.0 | консоль владельца/оператора |
| Student Portal (Золотой час) | 18791 | 0.0.0.0 (LAN/хотспот) | кабинет ученика |
| OpenClaw Gateway | 18789 | 127.0.0.1 | RPC/WebSocket агента |
| Grafana *(опц.)* | 3000 | 127.0.0.1 | мониторинг |
| Prometheus *(опц.)* | 9090 | 127.0.0.1 | метрики |

**Хотспот для телефонов:** Windows-хотспот выдаёт `192.168.137.1`. Ученик заходит на `http://192.168.137.1:18791/my/<token>`. Телефон должен быть подключён к Wi-Fi, который раздаёт этот ПК.

## Backend

### `backend.py` — Admin Dashboard (:18790)
HTTP-сервер консоли оператора. Ключевые эндпоинты: `/` (SPA), `/miniapp` (режим Mini App), `/api/bootstrap` (быстрый снапшот), `/api/snapshot` (полный: health, cron, задачи, roster, costs), CRUD `/api/tasks`, `/api/telegram/auth` (валидация `initData` по HMAC-SHA256), `/api/telegram/config`, `/api/chat/config`, `/api/costs` (разбивка расходов за 7 дней), `/api/grafana/status`, `/api/health`. Проксирует `/gh/*` на student portal (:18791) — чтобы обойтись одним HTTPS-туннелем для Telegram. Данные: `~/.openclaw/openclaw.json`, `~/.openclaw/secrets.json`, `memory/task-pool/*.json`, trajectory-логи сессий (для costs). Кэш CLI-вызовов (TTL ~45с).

### `student_portal_backend.py` — Student Portal (:18791)
HTTP-сервер кабинета ученика. Эндпоинты: `/` и `/student` (лендинг с инструкцией получить токен у бота), `/my/<token>` (дашборд при валидном токене), `/miniapp` (режим ученика), `/api/telegram/auth` (резолв ученика по Telegram ID), `/api/lan` (детект LAN-IP для хотспота), `/api/bootstrap` и `/api/snapshot` (снапшот из дневных планов), `/api/student/profile` (имя, класс, streak, минуты таймера), `/api/plan?date=…` (дневной план), `/api/chat/*` (история и отправка сообщений агенту через CLI), `PATCH /api/tasks/<id>` (смена статуса с проверками необратимости «Брошено»).

Данные: воркспейс агента `~/.openclaw/agents/golden-hour/workspace`, папки `users/tg-<id>/` (`profile.md`, `progress.md`, `plans/*.json`, `timer/stats.json`, `portal.json`), сопоставление сессий в `sessions/sessions.json` (student-сессии вида `agent:golden-hour:telegram:direct:<tg_id>`).

**Режим ученика** (CSS/JS shell): скрыты админ-функции (создание задач, inbox, roster, Grafana), видны только «Задачи / Календарь / Чат», бренд «🌅 Золотой час». Ограничения: нельзя создавать/удалять задачи через UI (их создаёт бот), нельзя править прошлые дни, нельзя вернуть задачу из `skipped` без подтверждения.

## Frontend

- **`dashboard.html`** — SPA на Vanilla JS без сборки. Bootstrap: сначала `/api/bootstrap` (мгновенный UI), затем `/api/snapshot` (данные). Вкладки: Задачи (Kanban 4 колонки), Календарь, Чат, Costs, Tools, Inbox (только admin). Режимы: admin / student / Telegram Mini App (класс `tg-miniapp`). Тема light/dark в localStorage.
- **`telegram-miniapp.js` + `.css`** — интеграция с Telegram WebApp SDK: тема из Telegram, нижняя навигация, синхронизация menu-button на `/miniapp`, auth через `initData` (HMAC). Не вызывает `expand()` (остаётся в панельном режиме).
- **`gateway-chat.js`** — WebSocket к gateway (:18789), протокол v4 (`{ type:"req", method, params, id }`), bearer-токен.
- **`student-chat-rpc.mjs`** (Node) — одноразовый RPC к gateway: `history --session … [--limit …]` и `send --session … --message …`. Используется backend'ом портала для `/api/chat/*`. Токен из `GATEWAY_AUTH_TOKEN` / `~/.openclaw/.env` / `secrets.json`.
- **`diag.py`, `diag2.py`** — диагностика.

## Модель задач dashboard

Пул задач admin — `memory/task-pool/active.json` (+ `history.json`):

```json
{ "version": "1.0", "tasks": [ {
  "id": "DASH-1234567890", "title": "…", "agent": "main",
  "status": "in_progress", "priority": "high", "complexity": "medium",
  "due_date": "2026-07-02", "spawned_at": "…", "tags": ["exam"],
  "created_at": "…", "updated_at": "…", "created_by": "agent:main", "source": "dashboard"
} ], "updated_at": "…" }
```

Задачи ученика — из `users/<key>/plans/YYYY-MM-DD.json` (см. [03. Модель данных](03-data-model.md)). Статусы Kanban ↔ plan JSON: `planned`/`in_progress`/`done`/`skipped`.

## PowerShell-скрипты (Windows)

| Скрипт | Что делает |
|---|---|
| `start_dashboard.ps1` | запускает `backend.py` (:18790), проверяет/поднимает gateway; флаги `-Port -Lan -NoBrowser -WithGrafana` |
| `start_student_portal.ps1` | запускает `student_portal_backend.py` (:18791, по умолчанию 0.0.0.0), детект LAN-IP; `-Port -LocalOnly -NoBrowser` |
| `start_student_portal_hotspot.ps1` | запуск ориентированный на хотспот `192.168.137.1` |
| `setup_telegram_miniapp.ps1` | admin в `-Lan`, cloudflared-туннель, установка menu-button через Telegram API; `-PublicUrl -BotToken -MenuText -SkipTunnel -SkipMenu` |
| `set_telegram_menu_button.ps1` | установка кнопки меню бота |
| `repair-portals.ps1` | чинит стек: gateway + admin + portal + watchdog; `-WithTunnels -WithTelegram` |
| `install-portal-autostart.ps1` | автозапуск портала |
| `watchdog.ps1` | контроль живости стека |
| `open-firewall-student-portal.ps1`, `open-portal-firewall.ps1` | правила брандмауэра |
| `lib.ps1` | общие функции: состояние портала (`.portal-state.json`), туннели (Cloudflare → Localtunnel фолбэк), Telegram menu, ensure-gateway/dashboard/portal, watchdog |

## Мониторинг (`dashboard/grafana/`)

Опциональный стек Grafana (:3000) + Prometheus (:9090), `docker-compose.yml`, авто-provisioning датасорса и дашборда `openclaw-overview`. Prometheus скрапит метрики gateway (`/api/diagnostics/prometheus`). `watchdog.ps1` перезапускает контейнеры при падении. Встраивается в admin-дашборд iframe'ом.

## Конфигурация

`dashboard/telegram-miniapp.env.example` — переменные для Mini App: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_MINIAPP_URL`, `TELEGRAM_MINIAPP_MENU_TEXT`, `OPENCLAW_HOME` и др. Дополнительно backend'ы распознают (но их нет в примере): `OPENCLAW_WORKSPACE` (`backend.py`), `GATEWAY_AUTH_TOKEN` (`backend.py`), `GH_STUDENT_PORTAL_HOST` (`student_portal_backend.py`). Секреты Telegram/gateway — в `~/.openclaw/secrets.json`.

## Поток «ученик»

```
1. Онбординг в Telegram → бот создаёт users/tg-<id>/profile.md, сессию
2. daily-plan / morning-plan → users/tg-<id>/plans/YYYY-MM-DD.json
3. Ученик открывает Mini App («🌅 Задачи») или /my/<token>
   → auth по initData/токену → резолв users/tg-<id>/
   → /api/snapshot грузит планы → Kanban/Календарь
   → отметка статуса → PATCH /api/tasks/<id> → запись обратно в plans/*.json
4. Чат: POST /api/chat/send → openclaw agent --session-key … -m "…" → ответ
```

Система работает офлайн (кроме вызовов LLM API): дашборд, портал и хранилище — локально на ПК, телефон подключается через хотспот.

> Документы: `dashboard/README.md`, `dashboard/STATUS.md`, `dashboard/TELEGRAM_MINIAPP.md`.
</content>
