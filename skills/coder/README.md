# coder

> Delegate every code request in chat to the `code-writer` subagent. The main session never writes code directly.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-skill-blue)](https://docs.openclaw.ai)

## Что это

OpenClaw-скилл, который делает один простой, но **не подлежащий обсуждению** поступок: пересылает любой пользовательский запрос на код в саб-агент `code-writer` через `sessions_spawn`. Main-сессия (которая общается с пользователем) физически не пишет код — это архитектурное решение, а не оптимизация.

Зачем:
- **Изоляция контекста.** Code-writer не видит историю диалога, не отвечает за неё, не отвлекается.
- **Observability.** Понятно, кто сгенерил какой код — main или sub-agent.
- **Эволюция специалиста.** Code-writer можно тюнить отдельно (модель, промпт, tools), не ломая общение с пользователем.
- **Стоимость «лишнего» шага.** Sub-session — это sub-session. Стоимость предсказуема, не зависит от размера задачи.

## Архитектура

```
┌────────────────────┐  user msg     ┌────────────────────┐
│  Telegram / webchat├──────────────►│  main (orchestrator)│
└────────────────────┘               │  - read, message,   │
                                     │  - sessions_spawn   │
                                     │  - web_*, cron,     │
                                     │    *_goal, ...      │
                                     └─────────┬──────────┘
                                               │ sessions_spawn
                                               │ agentId=code-writer
                                               ▼
                                     ┌────────────────────┐
                                     │  code-writer       │
                                     │  (isolated spec.)  │
                                     │  - read, write,    │
                                     │  - edit,           │
                                     │  - apply_patch,    │
                                     │  - exec, process   │
                                     └─────────┬──────────┘
                                               │ return code
                                               ▼
                                     ┌────────────────────┐
                                     │  main renders:     │
                                     │  ```lang           │
                                     │  ...code...        │
                                     │  ```               │
                                     │  1-line note       │
                                     └────────────────────┘
```

## Установка

### 1. Положить скилл в воркспейс main-агента

```bash
cp -r skills/coder ~/.openclaw/workspace/skills/
```

### 2. Убедиться, что в `openclaw.json` есть оба агента и binding

Минимальный конфиг — см. `references/architecture.md`. Ключевые точки:

- `agents.list` содержит и `main`, и `code-writer`.
- `main.subagents.allowAgents` включает `code-writer`.
- `bindings` маршрутизирует нужный канал (например, `telegram`) на `main`.
- `main.tools.deny` блокирует `write`, `edit`, `apply_patch`, `exec`, `process` — main физически не может генерить код сам. Это страховка: даже если скилл по какой-то причине не загрузится, архитектура всё равно работает.

### 3. Перезапустить gateway

```bash
openclaw config validate
openclaw gateway restart
```

## Как проверить, что работает

В Telegram (или другом канале, привязанном к main):

1. `/new` — стартовать свежую сессию (старая может держать кэшированный контекст).
2. «Напиши функцию факториала на Python».
3. В ответе main должно быть либо явное указание на саб-агента, либо молчаливый spawn, но **не** код, сгенерированный прямо в чате.
4. Код в итоге приходит в fenced-блоке с правильным языковым тегом.

Если main всё равно отвечает «сделал сам, мелкая задача» — значит, сессия не подхватила новый скилл, нужен `/new`.

## Известные ограничения

- Скилл не блокирует **генерацию кода в тексте ответа** на уровне модели — модель всегда может вывести код в чат без тулов. Блокировка работает на уровне `tools.deny` для записи/исполнения, плюс через `AGENTS.md` (см. `references/tool-restrictions.md`). Если модель сопротивляется — добавить правило в SOUL.md main-агента.
- `coder` работает **только** в паре с `code-writer`-агентом. Без него `sessions_spawn` упадёт.
- Скилл не покрывает code review, refactor существующего кода, отладку — только генерацию по запросу.

## Структура файлов

```
skills/coder/
├── SKILL.md              # сам скилл
├── README.md             # этот файл
├── LICENSE               # MIT
├── proposal.json         # метаданные Skill Workshop
├── references/
│   ├── architecture.md   # детальная схема main ↔ code-writer
│   └── tool-restrictions.md  # почему main деноит code-writing tools
└── examples/
    ├── factorial-python.md   # happy path: пользователь просит код, main делегирует
    └── ambiguous-sort.md     # edge case: уточняющий вопрос перед spawn
```
