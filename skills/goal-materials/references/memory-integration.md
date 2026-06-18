# Memory integration

## Что пишется и куда

| Событие | `memory/notes.jsonl` | `memory/YYYY-MM-DD.md` |
|---|---|---|
| `add` (от пользователя) | ✅ строка | ✅ строка |
| `add` (web_search) | ✅ строка | ✅ строка |
| `status → understood` | ❌ | ✅ строка |
| `status → stuck` | ❌ | ✅ строка |
| `status → archived` | ❌ | ✅ строка |
| `status → working` | ❌ | ❌ |

## Формат строки в `notes.jsonl`

```json
{"type":"material","id":"m_8a1f2c3d","goal_id":"exam_math_profile","material_type":"problem","title":"Задача 16: стереометрия (куб)","tags":["стереометрия","егэ-профиль"],"source":"user","source_url":null,"path":"materials/exam_math_profile/problems/2026-06-18_stereometriya_kub.md","is_idea":false,"created_at":"2026-06-18T12:42:00+03:00"}
```

Поля:
- `type` — всегда `"material"`
- `id` — id материала
- `goal_id` — к какой цели
- `material_type` — problem/theory/link/file/note
- `title` — название
- `tags` — массив
- `source` — `user` | `web_search`
- `source_url` — URL для link/web_search, иначе `null`
- `path` — путь к файлу
- `is_idea` — всегда `false`
- `created_at` — ISO

## Формат строки в `memory/YYYY-MM-DD.md`

```
- 12:42  📎 [exam_math_profile] problem «Задача 16: стереометрия (куб)» → materials/exam_math_profile/problems/2026-06-18_stereometriya_kub.md
- 12:43  ✓ [exam_math_profile] m_8a1f2c3d → understood
- 12:44  ❌ [exam_math_profile] m_b7e4d2a1 → stuck
- 12:45  🗑 [exam_math_profile] m_6d2a8b4c → archived
```

Префиксы:
- `📎` — материал добавлен
- `✓` — разобрано
- `❌` — застряла
- `⏭` — пропущено
- `🗑` — в архив

## Атомарность

`memory/notes.jsonl` — append-only. Дописывать одной строкой.
`memory/YYYY-MM-DD.md` — append.

Если файл `notes.jsonl` отсутствует — создать пустой и начать запись.