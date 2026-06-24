# Golden Hour — Deployment Guide

Деплой автоматически запускается при push в ветку **`deploy`**.

## Требования к серверу

- Ubuntu 22.04 LTS / Debian 12+
- OpenClaw CLI установлен (`openclaw --version`)
- Node.js ≥ 18
- SSH-доступ с нестандартным портом (по умолчанию `47832`)

## Первичная настройка сервера (один раз)

```bash
# Клонировать репозиторий и запустить setup
git clone -b deploy https://github.com/margoshkagt-star/Golden-Hour.git /opt/golden-hour
cd /opt/golden-hour

# Запустить setup (от root)
sudo bash deploy/setup-server.sh
```

Переменные для переопределения:
```bash
SSH_PORT=47822 BOT_USER=golden-hour DEPLOY_PATH=/opt/golden-hour \
  sudo bash deploy/setup-server.sh
```

## GitHub Secrets (Settings → Secrets and Variables → Actions)

| Secret | Описание |
|--------|----------|
| `SERVER_HOST` | IP или hostname сервера |
| `SERVER_USER` | SSH-пользователь (например, `ubuntu`) |
| `SSH_PRIVATE_KEY` | Приватный SSH-ключ deploy-пользователя |
| `SSH_PORT` | SSH-порт сервера (default: `47822`) |

## Порты

| Порт | Назначение | Переопределение |
|------|-----------|-----------------|
| `47822` | SSH сервера | Секрет `SSH_PORT` |
| `47832` | Внутренний порт приложения / health-check | `.env`: `APP_PORT` |
| `47843` | Webhook-порт (если не long-poll) | `.env`: `WEBHOOK_PORT` |

## Структура persistent-данных

Следующие директории **никогда не трогаются** при деплое (они в `.gitignore`):

```
/opt/golden-hour/
  users/           # Данные пользователей (profile.md, tasks.yaml, ...)
  data/teams/      # Командные задачи
  memory/          # Заметки оператора
  .env             # Секреты (не из git)
```

## Ручной деплой / отладка

```bash
# Посмотреть статус сервиса
sudo systemctl status golden-hour

# Логи в реальном времени
sudo journalctl -u golden-hour -f

# Перезапустить
sudo systemctl restart golden-hour

# Ручное обновление кода
cd /opt/golden-hour
git fetch origin deploy && git reset --hard origin/deploy
```

## Откат

```bash
# На сервере: откат к предыдущему коммиту
cd /opt/golden-hour
git log --oneline -5
git reset --hard <COMMIT_HASH>
sudo systemctl restart golden-hour
```
