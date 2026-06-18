# Storage schema

## Frontmatter (каждый материал)

```yaml
---
id: m_<8chars>
goal_id: g_<...>
type: problem | theory | link | file | note
tags: [тег1, тег2]
status: new | working | stuck | understood | archived
source: user | web_search
source_url: <url>
file_path: <path>
created_at: <ISO8601>
updated_at: <ISO8601>
status_history:
  - { status: new, at: <ISO8601> }
  - { status: working, at: <ISO8601> }
---
```

## index.json

```json
{
  "schema_version": 1,
  "by_id": {
    "m_a1b2c3d4": {
      "goal_id": "g_ege_math_profile",
      "type": "problem",
      "tags": ["параметры"],
      "status": "new",
      "path": "materials/g_ege_math_profile/problems/2026-06-18_parametry.md",
      "created_at": "2026-06-18T11:59:00+03:00",
      "updated_at": "2026-06-18T11:59:00+03:00"
    }
  }
}
```

`index.json` перестраивается командой `materials rebuild-index`.

## memory/notes.jsonl (доп. копия)

```json
{"type":"material","id":"m_<id>","goal_id":"...","material_type":"problem","title":"...","tags":[...],"source":"user|web_search","source_url":null,"path":"materials/.../file.md","is_idea":false,"created_at":"<ISO>"}
```

Append-only. Дописывается при `add`, не дописывается при `status`.

## memory/YYYY-MM-DD.md (дневник дня)

```
- HH:MM  📎 [goal_id] тип «название» → materials/.../file.md
- HH:MM  ✓ [goal_id] m_<id> → understood
- HH:MM  ❌ [goal_id] m_<id> → stuck
- HH:MM  🗑 [goal_id] m_<id> → archived
```

Дописывается при `add` и при смене статуса на `understood` / `stuck` / `archived`.