// Append check-in entries and update streak in progress.md.

import { todayISO, addDays } from "./dates.mjs";
import { isTaskDone } from "./plan-utils.mjs";

export function parseStreak(progressText) {
  const m = String(progressText || "").match(/\*\*Streak:\*\*\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

export function lastDiaryDate(progressText) {
  const matches = [...String(progressText || "").matchAll(/^### (\d{4}-\d{2}-\d{2})/gm)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1];
}

export function computeStreak(progressText, date) {
  const prev = lastDiaryDate(progressText);
  const current = parseStreak(progressText);
  if (!prev) return 1;
  if (prev === date) return current || 1;
  const yesterday = addDays(date, -1);
  if (prev === yesterday) return (current || 0) + 1;
  return 1;
}

export function ensureProgressSkeleton(name, date) {
  return `# Прогресс — ${name || "ученик"}

**Streak:** 0 дней · **Обновлён:** ${date}

## Закрытые темы

_(пока ничего не закрыто)_

## Дневник

`;
}

export function appendCheckin(progressText, { date, bullet, name }) {
  let text = progressText?.trim() ? progressText : ensureProgressSkeleton(name, date);
  const streak = computeStreak(text, date);
  const header = `**Streak:** ${streak} ${streak === 1 ? "день" : streak < 5 ? "дня" : "дней"} · **Обновлён:** ${date}`;

  if (/\*\*Streak:\*\*/i.test(text)) {
    text = text.replace(/\*\*Streak:\*\*[^\n]*/i, header);
  } else if (text.startsWith("# ")) {
    text = text.replace(/^(# [^\n]+)\n/, `$1\n\n${header}\n`);
  } else {
    text = `# Прогресс\n\n${header}\n\n${text}`;
  }

  const section = `### ${date}`;
  const line = `- ${bullet.trim()}`;

  if (text.includes(section)) {
    const idx = text.indexOf(section);
    const after = text.slice(idx + section.length);
    const nextHdr = after.search(/\n### /);
    const block = nextHdr === -1 ? after : after.slice(0, nextHdr);
    if (block.includes(line)) return { text, streak, duplicate: true };
    const insertAt = idx + section.length;
    text = `${text.slice(0, insertAt)}\n${line}${text.slice(insertAt)}`;
  } else if (text.includes("## Дневник")) {
    text = text.replace(/(## Дневник\s*\n)/, `$1\n${section}\n${line}\n`);
  } else {
    text = `${text.trim()}\n\n## Дневник\n\n${section}\n${line}\n`;
  }

  return { text, streak, duplicate: false };
}

export function planDayStats(plan) {
  const tasks = plan?.tasks || [];
  const done = tasks.filter((t) => isTaskDone(t)).length;
  return { done, total: tasks.length };
}
