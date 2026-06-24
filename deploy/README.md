# Golden Hour — Deployment Guide

Деплой автоматически запускается при push в ветку **`deploy`** и только в неё.

## Архитектура деплоя

```
GitHub push → deploy branch
        ↓
GitHub Actions (deploy.yml)
        ↓ SSH (restricted ForceCommand)
Server: run-deploy.sh
        ↓
  [backup users/] → [git reset --hard] → [fix perms] → [systemctl restart] → [health check]
        ↓ fail
  [auto rollback to prev commit]
```

## Требования к серверу

- Ubuntu 22.04 LTS / Debian 12+
- OpenClaw CLI установлен (`openclaw --version`)
- Node.js ≥ 18
- Пользователь для деплоя (например `ubuntu`) с SSH-доступом

## Первичная настройка сервера (один раз)

```bash
# Клонировать репозиторий
git clone -b deploy https://github.com/margoshkagt-star/Golden-Hour.git /opt/golden-hour
cd /opt/golden-hour

# Запустить setup (от root)
sudo bash deploy/setup-server.sh

# Переопределить параметры при необходимости:
# SSH_PORT=47822 DEPLOY_SUDO_USER=ubuntu sudo bash deploy/setup-server.sh
```

После setup:
1. Заполнить `/opt/golden-hour/.env` (добавить `TELEGRAM_BOT_TOKEN`)
2. Добавить deploy-ключ с `ForceCommand` в `~ubuntu/.ssh/authorized_keys` (инструкции выведет setup)
3. `sudo systemctl start golden-hour`

## Ключ деплоя (обязательно — ForceCommand)

Сгенерировать отдельный ключ только для деплоя:
```bash
ssh-keygen -t ed25519 -C "deploy@golden-hour" -f ~/.ssh/golden_hour_deploy
```

В `~/.ssh/authorized_keys` на сервере добавить с ForceCommand:
```
command="/opt/golden-hour/deploy/run-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... deploy@golden-hour
```

Это гарантирует, что даже если GitHub Actions или ключ скомпрометированы — на сервере можно запустить **только** `run-deploy.sh`, а не произвольные команды.

## GitHub Secrets (Settings → Secrets and Variables → Actions)

| Secret | Описание |
|--------|----------|
| `SERVER_HOST` | IP или hostname сервера |
| `SERVER_USER` | SSH-пользователь (например, `ubuntu`) |
| `SSH_PRIVATE_KEY` | Приватный deploy-ключ (см. выше) |
| `SSH_PORT` | SSH-порт сервера *(default: `47822`)* |

## Порты

| Порт | Назначение | Переопределение |
|------|-----------|-----------------|
| `47822` | SSH сервера | Секрет `SSH_PORT` |
| `47832` | Внутренний порт приложения / health-check | `.env`: `APP_PORT` |
| `47843` | Webhook-порт (если не long-poll) | `.env`: `WEBHOOK_PORT` |

## Защита пользовательских данных при деплое

```
/opt/golden-hour/
  users/           ← git-ignored, НИКОГДА не трогается git reset
  data/teams/      ← git-ignored, НИКОГДА не трогается git reset
  memory/          ← git-ignored, НИКОГДА не трогается git reset
  .env             ← git-ignored, chmod 600, owner golden-hour
```

`run-deploy.sh` перед каждым деплоем:
1. Создаёт `tar.gz`-бэкап в `/var/backups/golden-hour/` (последние 10)
2. Использует `git reset --hard` только для tracked-файлов (untracked не трогает)
3. **Никогда** не запускает `git clean`

## Graceful shutdown (защита от порченых файлов)

`golden-hour.service` имеет `TimeoutStopSec=30s` — systemd отправляет SIGTERM и ждёт 30 секунд перед SIGKILL.

**Приложение обязано** использовать атомарные записи:
```js
// НЕ делать:
await fs.writeFile(targetPath, data)

// Делать (атомарная запись — rename() атомарен на одной ФС):
const tmp = targetPath + '.tmp'
await fs.writeFile(tmp, data)
await fs.rename(tmp, targetPath)
```

## Откат

**Автоматически** — если health check после деплоя не прошёл, `run-deploy.sh` сам откатывается к предыдущему коммиту.

**Вручную:**
```bash
# На сервере
cd /opt/golden-hour
git log --oneline -5
git reset --hard <PREV_COMMIT>
sudo systemctl restart golden-hour
```

**Из бэкапа пользовательских данных:**
```bash
tar -xzf /var/backups/golden-hour/users-YYYYMMDD-HHMMSS.tar.gz \
  -C /opt/golden-hour
sudo systemctl restart golden-hour
```

## Мониторинг

```bash
# Статус сервиса
sudo systemctl status golden-hour

# Логи в реальном времени
sudo journalctl -u golden-hour -f

# Количество перезапусков (признак crash loop)
sudo systemctl show golden-hour --property=NRestarts

# Ресурсы
systemd-cgtop
```

## Многопользовательская работа

Бот обслуживает несколько пользователей через один процесс. Критично:

- Каждый пользователь изолирован в `users/tg-<id>/` — другие пользователи не имеют доступа
- Конкурентные записи в файлы **должны** использовать advisory lock или per-user очередь (см. C-3 в review)
- Ограничение памяти: `MemoryMax=512M`, `MemoryHigh=400M` (мягкий лимит с throttling)
- Лимит тасков: `TasksMax=256` (Node.js использует несколько потоков)
