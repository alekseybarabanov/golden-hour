# Architecture: main ↔ code-writer

## Roles

| Agent | Job | Tools |
|---|---|---|
| `main` | разговор с пользователем, маршрутизация, оркестрация, память, расписание, цели | `read`, `web_search`, `web_fetch`, `message`, `cron`, `sessions_spawn`, `sessions_list`, `sessions_send`, `skill_workshop`, `update_goal`, `update_plan`, `create_goal`, `get_goal` |
| `code-writer` | изолированный специалист по генерации кода | `read`, `write`, `edit`, `apply_patch`, `exec`, `process`, `web_search`, `web_fetch` |

Главное различие: **main не умеет писать/править/исполнять код**. Это не баг конфига, а требование архитектуры.

## Сценарий

```
1. User: "напиши функцию факториала на Python"
2. main грузит skills/coder/SKILL.md, видит: trigger = "user asks for code"
3. main резолвит язык: Python (указано пользователем)
4. main вызывает sessions_spawn({ agentId: "code-writer", prompt: <brief> })
5. main ждёт push-результата (completion-based, не polling)
6. code-writer пишет код, возвращает его
7. main рендерит в fenced-блоке ```python ... ``` + 1-3 строки пояснения
8. main отправляет в Telegram
```

Если на шаге 6 code-writer падает / молчит / возвращает пустоту — main **не** пишет код сам. Сообщает пользователю и спрашивает, как действовать.

## Конфиг (минимальный)

```json5
{
  agents: {
    list: [
      {
        id: "main",
        default: true,
        workspace: "~/.openclaw/workspace",
        model: { primary: "minimax/MiniMax-M3" },
        subagents: { allowAgents: ["code-writer"], requireAgentId: true },
        tools: {
          allow: [
            "read", "web_search", "web_fetch",
            "sessions_spawn", "sessions_list", "sessions_send",
            "message", "cron",
            "skill_workshop", "update_goal", "update_plan", "create_goal", "get_goal"
          ],
          deny: [
            "write", "edit", "apply_patch",
            "exec", "process",
            "image_generate", "music_generate", "video_generate"
          ]
        }
      },
      {
        id: "code-writer",
        workspace: "~/.openclaw/workspace-code",
        model: { primary: "minimax/MiniMax-M3" },
        tools: {
          allow: [
            "read", "write", "edit", "apply_patch",
            "exec", "process", "web_search", "web_fetch"
          ],
          deny: [
            "message", "cron",
            "sessions_send", "sessions_spawn", "sessions_list",
            "image_generate", "music_generate", "video_generate",
            "skill_workshop", "update_goal", "update_plan", "create_goal", "get_goal"
          ]
        }
      }
    ]
  },
  bindings: [
    { agentId: "main", match: { channel: "telegram" } }
  ]
}
```

## Почему deny, а не allowlist

OpenClaw merge'ит `allow` и `deny`. Если в `allow` перечислено **всё** нужное, а в `deny` — то, что main делать **не должен** (write/edit/apply_patch/exec/process), это:
- явный сигнал модели: «у тебя нет таких тулов, даже не пытайся»
- страховка: даже если скилл не подгрузился, модель физически не сможет ни записать файл, ни выполнить команду
- audit-friendly: видно на ревью, что main — оркестратор, не исполнитель

## Почему requireAgentId: true

Без этой опции `sessions_spawn` без `agentId` уходит в default-агент. С `true` — main обязан явно указать `agentId: "code-writer"`. Это защита от случайного спавна «в себя» или в неожиданного агента.
