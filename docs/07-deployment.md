# 07. Развёртывание, CI и планировщик

## Установка (локально, разработка)

Полная инструкция — [`INSTALL.md`](../INSTALL.md), кратко — [`SETUP.md`](../SETUP.md).

Требования: Node.js ≥18, OpenClaw CLI + gateway, Git; опционально Python ≥3.10 (дашборд/портал), Chrome/Edge (PNG-карточки), Telegram-бот от @BotFather.

```bash
# 1. Клонировать в воркспейс
git clone https://github.com/svirepymedved/golden-hour.git ~/.openclaw/workspaces/golden-hour
cd ~/.openclaw/workspaces/golden-hour

# 2. Скопировать шаблоны
cp USER.example.md USER.md
cp MEMORY.example.md MEMORY.md
cp memory/task-categories.example.md memory/task-categories.md
cp memory/user-priorities.example.md memory/user-priorities.md

# 3. Отредактировать USER.md (имя, таймзона, стиль общения)

# 4. Зарегистрировать агента в ~/.openclaw/openclaw.json
#    (фрагмент — openclaw.agent.example.json: agent golden-hour, subagent code-writer,
#     Telegram-аккаунт с командами, bindings telegram → golden-hour)

# 5. Секреты
cp secrets.example.json ~/.openclaw/secrets.json   # добавить TELEGRAM_BOT_TOKEN, Google OAuth (опц.)

# 6. Тесты и рестарт
node scripts/run-tests.mjs
openclaw gateway restart
```

## Конфигурация и секреты

### `openclaw.agent.example.json`
Шаблон для локального `~/.openclaw/openclaw.json`: агент `golden-hour` (workspace, model), sub-агент `code-writer`, Telegram-аккаунт с кастомными командами (`/plan`, `/today`, `/tasks`, `/timer`, `/checkin`, `/calendar` …), dmPolicy, bindings.

### `secrets.example.json`
```json
{
  "google": { "clientId": "…apps.googleusercontent.com", "clientSecret": "…" },
  "channels": { "telegram": { "golden-hour": { "botToken": "…" } } }
}
```
Альтернатива — переменные окружения (`TELEGRAM_BOT_TOKEN`, `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`); на сервере предпочтителен `.env` через systemd.

## Серверный деплой

### Первичная настройка (один раз)
`deploy/setup-server.sh` на свежем Ubuntu/Debian: пакеты (git, curl, ufw, fail2ban), Node.js, OpenClaw CLI, опционально Ollama + fallback-модель, системный пользователь `golden-hour` (без shell), клон репо (ветка `deploy`), персистентные каталоги (`users/`, `data/teams/`, `memory/`, `.openclaw/`), права, генерация `.env` с `OPENCLAW_GATEWAY_TOKEN`, копия `openclaw.config.json` → `.openclaw/openclaw.json`, systemd-сервис + sudoers, ужесточение SSH (порт 47822, без root, только ключи), UFW + fail2ban.

Переопределяемые env: `BOT_USER`, `DEPLOY_PATH` (`/opt/golden-hour`), `SSH_PORT`, `NODE_VERSION`, `DEPLOY_SUDO_USER`, `INSTALL_OLLAMA`, `OLLAMA_FALLBACK_MODEL`.

После настройки: заполнить `/opt/golden-hour/.env` (`MINIMAX_API_KEY`, `TELEGRAM_BOT_TOKEN`), добавить deploy-ключ в `authorized_keys` с `ForceCommand`, `systemctl start golden-hour`.

### Конвейер деплоя
```
push в ветку 'deploy'
   → GitHub Actions (deploy.yml)
   → SSH (appleboy/ssh-action) на сервер, передаёт github.sha
   → ForceCommand: ssh-deploy-wrapper.sh (извлекает только 40-hex SHA, игнорит остальное)
   → sudo run-deploy.sh <SHA>:
       1. бэкап users/ + data/ + memory/ → /var/backups/golden-hour/
       2. git fetch + reset --hard origin/deploy (только трекаемые файлы)
       3. права (scripts/skills исполняемые)
       4. синк openclaw.json + systemd unit
       5. systemctl restart golden-hour (graceful, TimeoutStopSec=30s)
       6. health-check (3 стабильных сэмпла)
       7. авто-откат при провале health-check
```

**Модель угроз деплоя (defense-in-depth):** SSH ForceCommand игнорирует любые команды кроме извлечения SHA; sudo NOPASSWD только на `run-deploy.sh`; сам `run-deploy.sh` — `root:root 555`; в `openclaw.json` только `${ENV_VAR}`, секреты резолвятся в рантайме.

### systemd (`deploy/service/golden-hour.service`)
Env: `HOME=/opt/golden-hour`, `NODE_ENV=production`, `TZ=Europe/Moscow`, `OPENCLAW_CONFIG_PATH`, gateway на loopback (порт 47854), секреты из `EnvironmentFile=-/opt/golden-hour/.env`. `ExecStart`: `openclaw gateway --bind loopback --port …`. Рестарт always (10с). Graceful shutdown (SIGTERM + 30с → SIGKILL) → записи данных должны быть атомарными (`.tmp` → rename). Лимиты: `MemoryMax=768M`, `MemoryHigh=640M`, `TasksMax=256`, `LimitNOFILE=65536`. Хардненинг: `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/opt/golden-hour`, `PrivateTmp`, `ProtectHome`. Crash-loop guard: `StartLimitBurst=5`/120с.

### `deploy/openclaw.config.json`
Серверный конфиг: gateway loopback-only; модели merge (primary MiniMax-M3 через Anthropic-совместимый API, `${MINIMAX_API_KEY}`, контекст 1M; fallback локальный Ollama при сбое MiniMax); агенты `golden-hour` (полный тулинг, запрещена только генерация медиа) и `code-writer` (изолированный, без message/cron/sessions/media); Telegram-канал `golden-hour` (`dmPolicy: open`, кастомные команды); сессии `dmScope: per-channel-peer` (отдельная сессия на пользователя); bindings telegram → golden-hour.

## CI (`.github/workflows/`)

### `test-golden-hour.yml`
Триггеры: push в main/master/agent-install/deploy, pull_request. На Ubuntu, Node 20: unit-тесты (`run-tests.mjs`, 71+) + smoke (`exam-topics.mjs list`, `cleanup-cards.mjs --dry-run`).

### `deploy.yml`
Триггер: push только в ветку `deploy`. Concurrency: один деплой за раз. Валидирует секреты (`SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT`), выполняет SSH-деплой (см. конвейер выше), отчитывается о статусе.

## Планировщик (cron / heartbeat)

Периодические задачи — детерминированные скрипты **без LLM**; доставка через `cron-deliver.mjs` + `TELEGRAM_BOT_TOKEN`. Подробности — [`HEARTBEAT.md`](../HEARTBEAT.md).

| Время (MSK) | Скрипт | Действие | Доставка |
|---|---|---|---|
| 07:00 | `morning-plan.mjs` | сгенерировать `plans/YYYY-MM-DD.json` всем | нет |
| ~09:00 (окно 7–10, */15) | `morning-brief.mjs` | сводка плана готовым пользователям | Telegram Bot API |
| каждые 5 мин | `task-pings.mjs` | пинги задач по `scheduled_at` (макс 3/день, тихие часы 23–08) | Telegram Bot API |
| ~21:00 (окно 20–22, */15) | `evening-checkin.mjs` | приглашение к вечернему чек-ину | Telegram Bot API |
| каждую 1 мин | `timer-tick.mjs` | переходы фаз таймера, уведомления | Telegram Bot API |
| еженедельно | `cleanup-cards.mjs --keep 20` | ретеншен PNG | нет |

**Утренний cron пишет план без dry-run**; ручной «спланируй день» — всегда dry-run → подтверждение.

### Регистрация (Windows)
```powershell
.\scripts\cron\register-all-cron.ps1        # все задачи (OpenClaw cron)
.\scripts\cron\register-morning-plan.ps1    # только morning-plan
.\scripts\cron\register-task-scheduler.ps1  # через Windows Task Scheduler (без gateway)
.\scripts\cron\cleanup-golden-hour-cron.ps1 # снять задачи
```

### Регистрация (Linux / Raspberry Pi)
systemd user-таймеры вместо `.ps1` (те же 6 задач, локальное время):
```bash
bash deploy/pi/install-timers.sh
loginctl enable-linger "$USER"
```
Плюс настройка таймзоны (`GH_TZ`) и портала по LAN Pi. Полный гайд: [`deploy/pi/README.md`](../deploy/pi/README.md).
Пример payload и документация — `scripts/cron/morning-plan.job.json`, `scripts/cron/morning-plan.md`.

### Идемпотентность
State-файлы против дублей: `.delivery-state-brief.json`, `.delivery-state-checkin.json`, `.ping-state-*.json`. Сбои cron логируются (`memory/cron-errors.jsonl`), при заданном `GH_OWNER_CHAT_ID` — алерт владельцу.

### Ручной heartbeat (фолбэк)
Если cron недоступен: запустить скрипт (`node scripts/morning-brief.mjs`), прочитать `results[].notifications[]`, отправить каждое `message` пользователю `user_key` через Telegram (без inline-кнопок), отметить state.
</content>
