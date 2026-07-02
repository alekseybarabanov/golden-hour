# Dashboard — статус проекта

**Файл:** `dashboard/STATUS.md`  
**Обновлено:** 2026-07-02
**Решение:** **Вариант C (гибрид)** · шапка **Фельпик** ⚙️

> Помимо admin-дашборда «Фельпик» в папке `dashboard/` живут **Student Portal** (кабинет ученика, `student_portal_backend.py`, :18791) и **Telegram Mini App** (`telegram-miniapp.js/.css`, `setup_telegram_miniapp.ps1`). Полное описание — [`../docs/06-dashboard.md`](../docs/06-dashboard.md).

---

## Решения по архитектуре

| Вопрос | Ответ |
|--------|--------|
| Стратегия | **C** — свой dashboard + Claw Dash + Control UI |
| Имя в шапке | **Фельпик** |
| Grafana | **Да** — `grafana/start_grafana.ps1` + Costs → Grafana |
| Roster агентов | Авто из `openclaw.json` (8 агентов) |

---

## Вариант C — кто за что отвечает

| Инструмент | URL | Задача |
|------------|-----|--------|
| **Фельпик Dashboard** | `http://127.0.0.1:18790` | Kanban, Costs, Files, Roster, Crons |
| **Control UI** | `http://127.0.0.1:18789/chat` | Чат с агентом |
| **Claw Dash** | `http://127.0.0.1:3939` | Topology, Activity, System console |
| Grafana | `http://127.0.0.1:3000` | OTel/Prometheus — вкладка **Costs** → Grafana |

### Grafana (локально)

```powershell
cd dashboard\grafana
.\start_grafana.ps1
# Dashboard: http://127.0.0.1:3000/d/openclaw-overview/openclaw-overview

openclaw gateway restart   # после diagnostics-prometheus
```

Метрики: gateway → `diagnostics-prometheus` → dashboard proxy `/api/prometheus/metrics` → Prometheus → Grafana.


---

## Phase 1 (сделано в этой итерации)

- KPI-шапка: Agents, Crons, Cost Today, System
- Roster из `openclaw.json` (Фельпик, Золотой час, Skill Forge, …)
- Kanban Tasks (todo / progress / done / archive)
- Вкладка **Costs** — переключатель **Встроенный** ↔ **Grafana** (выбор сохраняется в браузере)
- Вкладка **Tools** — ссылки на Control UI и Claw Dash
- Backend: `agents_roster`, `costs`, `portal` в `/api/snapshot`

---

## Агенты в roster (авто)

1. **Фельпик** ⚙️ — `main`
2. **Золотой час** 🌅 — `golden-hour`
3. **Skill Forge** 🔨 — `skill-forge`
4. **Локалка** 🖥️ — `local`
5. **Виктор** 💙 — `vk-buddy`
6. **Лист** 🌱 — `local-clean`
7. **Notes-Keeper** 📓 — `notes-keeper`
8. **Forge Skill** 🔨 — `forge-skill`

---

## Запуск

```powershell
cd dashboard
.\start_dashboard.ps1
# → http://127.0.0.1:18790/
```

**Важно:** не открывайте `dashboard.html` двойным кликом (file://) — будет вечный loading.

Первый snapshot ~10–15 сек. Интерфейс появляется сразу через `/api/bootstrap`.

### Светлая тема

Кнопка ☀️/🌙 в шапке. Выбор сохраняется в браузере.

### Без интернета / локальная сеть

| Компонент | Без интернета | LAN |
|-----------|---------------|-----|
| Фельпик Dashboard | ✅ (файлы + CLI локально) | ✅ `.\start_dashboard.ps1 -Lan` |
| Control UI / Gateway | ✅ UI локально | ✅ по IP ПК :18789 |
| Claw Dash | ✅ если `npm run dev` локально | ✅ |
| Grafana | ✅ если установлен локально | ✅ |
| **Агенты (LLM)** | ❌ нужен API провайдера | ❌ |

Интернет нужен только когда агенты ходят в облако (MiniMax и т.д.). Сам dashboard — офлайн.

```powershell
.\start_dashboard.ps1 -Lan   # слушает 0.0.0.0:18790
# с телефона: http://192.168.x.x:18790/
```

---

## Реализовано после Phase 1

- **Drag-and-drop kanban + создание задач** — есть в `dashboard.html` (обработчики `dragstart`/`dragover`/`drop`/`dragend`, модалка создания).
- **Student Portal** (`student_portal_backend.py`, :18791) + режим ученика в общем `dashboard.html`.
- **Telegram Mini App** (`telegram-miniapp.js/.css`, `setup_telegram_miniapp.ps1`, cloudflared-туннель, menu-button).
- **Grafana/Prometheus** стек в `grafana/` (docker-compose, provisioning, watchdog).

## Дальше (Phase 2+)

- WS вместо CLI polling
- Operations (restart gateway, backup)
- Grafana — расширение панелей (p95 latency / queue depth) при необходимости

---

## Файлы (основное)

```
dashboard/
├── backend.py                    # admin-дашборд «Фельпик» (:18790)
├── student_portal_backend.py     # кабинет ученика Golden Hour (:18791)
├── dashboard.html                # общий SPA (admin / student / Mini App)
├── telegram-miniapp.js / .css    # интеграция Telegram WebApp
├── gateway-chat.js               # WebSocket-чат к gateway (:18789)
├── student-chat-rpc.mjs          # одноразовый RPC к gateway для чата портала
├── diag.py / diag2.py            # диагностика
├── grafana/                      # мониторинг: docker-compose, prometheus, provisioning, watchdog
├── *.ps1                         # запуск/чинка/автозапуск/туннели/firewall (start_*, repair-portals, watchdog, lib.ps1 …)
├── telegram-miniapp.env.example  # переменные Mini App
├── TELEGRAM_MINIAPP.md           # настройка Mini App
├── README.md
└── STATUS.md
```

> Полная карта эндпоинтов, портов и потоков данных — в [`../docs/06-dashboard.md`](../docs/06-dashboard.md).
