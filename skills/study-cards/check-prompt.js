#!/usr/bin/env node
// check-prompt.js — pre-flight guard для image_generate / render
//
// Использование:
//   node check-prompt.js --tool=image_generate --prompt="..." [--strict] [--json]
//   node check-prompt.js --tool=image_generate --source=plan.json     (рекурсивно по JSON)
//   node check-prompt.js --tool=render --prompt="..."
//
// Exit codes:
//   0 = ok
//   1 = warning (только при --strict, иначе soft-warn в stdout)
//   2 = usage error
//
// Что считает "опасным":
//   Любой символ вне ASCII (\x00-\x7F): кириллица, арабица, CJK, иврит,
//   тайский, деванагари, прочие не-латинские алфавиты. Emoji — тоже варнинг
//   (модель может сломать их в теле таблицы).
//
// Правило:
//   image_generate + не-ASCII → ❌ сломанный рендер → используй render.js
//   render (HTML+Edge) + не-ASCII → ✅ ОК, шрифты системные

const fs = require('fs');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

const TOOL = arg('--tool', null);
const PROMPT = arg('--prompt', null);
const SOURCE = arg('--source', null);
const STRICT = has('--strict');
const JSON_OUT = has('--json');

if (!TOOL) {
  console.error('Usage: node check-prompt.js --tool=<image_generate|render> [--prompt=...] [--source=...] [--strict] [--json]');
  process.exit(2);
}
if (!PROMPT && !SOURCE) {
  console.error('Provide --prompt="..." or --source=file.json');
  process.exit(2);
}

// Категории не-ASCII (от частых к редким, last one — общий не-ASCII для учёта emoji)
const CATEGORIES = [
  { name: 'cyrillic',     label: 'Кириллица',       re: /[\u0400-\u04FF\u0500-\u052F]/g },
  { name: 'arabic',       label: 'Арабица',         re: /[\u0600-\u06FF]/g },
  { name: 'cjk',          label: 'CJK (кит/яп/кор)', re: /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g },
  { name: 'hebrew',       label: 'Иврит',           re: /[\u0590-\u05FF]/g },
  { name: 'thai',         label: 'Тайский',         re: /[\u0E00-\u0E7F]/g },
  { name: 'devanagari',   label: 'Деванагари',      re: /[\u0900-\u097F]/g },
  { name: 'emoji',        label: 'Emoji',           re: /\p{Extended_Pictographic}/gu },
];

function scanText(text) {
  const found = [];
  for (const c of CATEGORIES) {
    const m = text.match(c.re);
    if (m) found.push({ category: c.name, label: c.label, count: m.length, sample: m.slice(0, 6).join(' ') });
  }
  return found;
}

function walkStrings(obj, p = '') {
  const out = [];
  if (typeof obj === 'string') {
    const f = scanText(obj);
    if (f.length) out.push({ path: p, text: obj.length > 100 ? obj.slice(0, 100) + '…' : obj, findings: f });
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...walkStrings(v, `${p}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) out.push(...walkStrings(obj[k], p ? `${p}.${k}` : k));
  }
  return out;
}

let entries = [];
if (PROMPT) entries.push({ path: '<prompt>', text: PROMPT, findings: scanText(PROMPT) });
if (SOURCE) {
  if (!fs.existsSync(SOURCE)) { console.error(`File not found: ${SOURCE}`); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  entries = entries.concat(walkStrings(data));
}

const hasNonAscii = entries.some(e => e.findings.length > 0);

let status, message;
if (TOOL === 'image_generate') {
  if (hasNonAscii) { status = 'WARN'; message = '❌ Не-ASCII в prompt + image_generate = сломанный рендер (кириллица в body таблиц превращается в обрывки)'; }
  else { status = 'OK'; message = '✅ Prompt чистый, image_generate безопасен'; }
} else if (TOOL === 'render') {
  status = 'OK';
  message = '✅ HTML+Edge рендер — кириллица не ломается (шрифты системные)';
} else {
  console.error(`Unknown tool: ${TOOL}. Use image_generate or render.`);
  process.exit(2);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ status, tool: TOOL, hasNonAscii, entries }, null, 2));
} else {
  console.log(`[${status}] ${message}`);
  if (status === 'WARN') {
    console.log('');
    console.log('Найдено:');
    for (const e of entries) {
      if (!e.findings.length) continue;
      console.log(`  ${e.path}: "${e.text}"`);
      for (const f of e.findings) console.log(`    → ${f.label}: ${f.count} шт. (пример: ${f.sample})`);
    }
    console.log('');
    console.log('💡 Решение: используй render.js (HTML + Edge) — кириллица рисуется браузером, не моделью.');
    console.log('   node render.js --source=examples/plan.example.json --themes=light,dark');
  }
}

process.exit(status === 'WARN' && STRICT ? 1 : 0);
