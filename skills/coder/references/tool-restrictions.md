# Tool restrictions: why main can't write code

## Что именно запрещено и зачем

| Tool | Статус у main | Зачем запрещать |
|---|---|---|
| `write` | ❌ deny | не даёт main создавать/перезаписывать файлы — только sub-agent |
| `edit` | ❌ deny | то же для точечных правок |
| `apply_patch` | ❌ deny | «кодо-писательский» инструмент; main вообще не должен его видеть |
| `exec` | ❌ deny | shell; main не запускает команды, всё через sub-agent |
| `process` | ❌ deny | long-running процессы; не задача main |
| `image_generate` | ❌ deny | медиа — отдельный sub-agent (когда появится) |
| `music_generate` | ❌ deny | то же |
| `video_generate` | ❌ deny | то же |

## Что у main осталось

| Tool | Зачем |
|---|---|
| `read` | читать workspace, логи, контекст |
| `web_search`, `web_fetch` | research перед делегацией, если нужно уточнить стек/либу |
| `sessions_spawn` | **главный** — спавнить sub-agent'ов (включая code-writer) |
| `sessions_list`, `sessions_send` | управлять существующими сессиями |
| `message` | слать сообщения в каналы (Telegram и т.п.) |
| `cron` | scheduled tasks |
| `skill_workshop` | создавать/обновлять скиллы |
| `update_goal`, `update_plan`, `create_goal`, `get_goal` | управление целями/планами пользователя |

## Многослойная защита от «сделаю сам»

Скилл `coder` без tool-restriction'ов — это **только инструкция**. Модель может её интерпретировать гибко и в итоге сказать «мелкая задача, дешевле самому». Это мы и наблюдали в реальном тесте.

Реальная защита — **четыре слоя**, не один:

1. **Tool restriction.** Main физически не может выполнить `write`/`exec` — модель не сможет даже попытаться, OpenClaw отрежет вызов.
2. **AGENTS.md (hard rule).** `~/.openclaw/workspace/AGENTS.md` содержит секцию Red Lines с правилом «вы не генерите код в этой сессии, всегда делегируете». AGENTS.md инжектится в system prompt на каждом запуске сессии.
3. **Skill body.** `skills/coder/SKILL.md` с description `MANDATORY: every user code request is delegated…` срабатывает, когда модель выбирает скилл по триггеру.
4. **Subagent context.** Code-writer не видит диалог с пользователем. Каждый запрос — свежий, изолированный. Это даёт специалисту возможность эволюционировать отдельно.

## Почему не вынести правило в системный промпт main

Можно. Дополнительная строка в `agents.list[].promptOverlays` или в custom system prompt закрепит. Но текстовые правила модели могут игнорировать под давлением контекста (длинная сессия, пользователь давит «ну сделай быстро»). Tool restriction + AGENTS.md + skill + изоляция — это **четыре независимых рычага**, каждый из которых снижает вероятность обхода. Все четыре дешевле, чем полагаться на один.
