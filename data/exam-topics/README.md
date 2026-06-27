# Exam topic codifiers

JSON-файлы для `scripts/exam-topics.mjs`.

```bash
node scripts/exam-topics.mjs list
node scripts/exam-topics.mjs show --id ege-math-profile
node scripts/exam-topics.mjs apply --user tg-123 --exam-type ege --exam-subject math --variant profile
```

Добавление: новый `*.json` с полями `id`, `exam_type`, `exam_subject`, `topics[]`.
