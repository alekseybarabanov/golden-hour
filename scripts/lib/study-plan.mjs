// Generate users/<user_key>/plan.md from profile.

import { weeksBetween, todayISO } from "./dates.mjs";
import { getTopicsFromProfile } from "./profile.mjs";
import {
  weightTopics,
  sortByPriority,
  computeEffPriority,
} from "./task-weighting.mjs";
export function allocateHours(topics, totalHours, profile, today) {
  const weighted = sortByPriority(
    topics.map((t) => ({
      ...t,
      eff_priority: computeEffPriority(t.title, profile, today),
    }))
  );

  const sumP = weighted.reduce((s, t) => s + t.eff_priority, 0) || 1;
  let allocated = weighted.map((t) => ({
    ...t,
    hours: Math.max(1, Math.round((t.eff_priority / sumP) * totalHours * 0.85)),
  }));

  let used = allocated.reduce((s, t) => s + t.hours, 0);
  const reserve = Math.max(0, totalHours - used);
  const finalBlock = {
    title: "Финал: пробники + повтор",
    level: "—",
    hours: reserve || Math.round(totalHours * 0.1),
    eff_priority: 3,
  };

  return { topics: allocated, finalBlock, totalHours };
}

export function assignWeeks(topics, totalWeeks, hoursPerWeek) {
  let week = 1;
  const rows = [];

  for (const t of topics) {
    const w = Math.max(1, Math.ceil(t.hours / hoursPerWeek));
    const start = week;
    const end = Math.min(totalWeeks, week + w - 1);
    week = end + 1;
    rows.push({
      ...t,
      weeks: { start, end },
      difficulty: t.level === "weak" || t.level === "с нуля" ? 4 : 3,
    });
  }

  return rows;
}

export function renderPlanMarkdown(profile, rows, finalBlock, meta) {
  const name = profile.name || "ученик";
  const purpose = profile.purpose || "exam";
  const deadline = profile.deadline || "без дедлайна";
  const hpw = profile.hours_per_week || 7;
  const load = profile.daily_load || "normal";
  const budgetMap = { light: 6, normal: 9, intense: 12 };
  const budget = budgetMap[load] || 9;

  const totalHours = meta.totalHours;
  const totalWeeks = meta.totalWeeks;
  const today = meta.today;

  let goalLine = purpose;
  if (purpose === "exam") {
    goalLine = `${profile.exam_type || "экзамен"} — ${profile.exam_subject || "предмет"}`;
  } else if (purpose === "olympiad") {
    goalLine = `олимпиада — ${profile.olympiad_subject || "предмет"}, ${profile.grade || ""} кл.`;
  } else {
    goalLine = `тема — ${profile.study_topic || profile.study_subject || "изучение"}`;
  }

  const lines = [];
  lines.push(`# План подготовки — ${name}`);
  lines.push("");
  lines.push(
    `> Создан: ${today} (скрипт study-plan.mjs)`
  );
  lines.push(
    `> Цель: **${goalLine}** · Дедлайн: **${deadline}** · **${hpw} ч/нед**`
  );
  lines.push(`> Темп: **${load}** (бюджет дня: ${budget})`);
  lines.push("");
  lines.push("## Бюджет");
  lines.push(`- Недель до дедлайна: **${totalWeeks}**`);
  lines.push(`- Всего часов: **${totalHours}**`);
  lines.push("- Распределение (пропорционально `eff_priority`):");
  lines.push("");
  lines.push("| Тема | eff_p | Часов |");
  lines.push("|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.title} | ${r.eff_priority} | **${r.hours}** |`);
  }
  lines.push(`| ${finalBlock.title} | — | **${finalBlock.hours}** |`);
  lines.push(`| **Итого** | | **${totalHours}** |`);
  lines.push("");
  lines.push("## Темы (порядок: важные + слабые → финал)");
  lines.push("");
  lines.push("| # | Тема | Уровень | Часов | Недели | Сложность |");
  lines.push("|---|---|---|---|---|---|");

  rows.forEach((r, i) => {
    const w =
      r.weeks.start === r.weeks.end
        ? `${r.weeks.start}`
        : `${r.weeks.start}–${r.weeks.end}`;
    lines.push(
      `| ${i + 1} | ${r.title} | ${r.level} | ${r.hours} | ${w} | ${r.difficulty} |`
    );
  });
  const fStart = rows.length ? rows[rows.length - 1].weeks.end + 1 : 1;
  const fEnd = totalWeeks;
  lines.push(
    `| ${rows.length + 1} | **${finalBlock.title}** | — | ${finalBlock.hours} | ${fStart}–${fEnd} | микс |`
  );

  lines.push("");
  lines.push("## Понедельный скелет");
  lines.push("");
  for (const r of rows) {
  const w =
      r.weeks.start === r.weeks.end
        ? `${r.weeks.start}`
        : `${r.weeks.start}–${r.weeks.end}`;
    lines.push(
      `${r.weeks.start}. **Нед. ${w}** — **${r.title}**: теория → практика → закрепление`
    );
  }
  lines.push(
    `${fStart}. **Нед. ${fStart}–${fEnd}** — **${finalBlock.title}**: пробные варианты + разбор ошибок`
  );

  lines.push("");
  lines.push("## Чек-поинты");
  lines.push("- По итогу каждой темы — короткий тест 5–10 заданий");
  lines.push("- Раз в ~4 недели — пробный вариант");
  lines.push("- Слабые темы → spaced repetition (1 → 3 → 7 → 14 → 30)");
  lines.push(`- Недельный ритм: ${hpw} ч`);
  lines.push("");
  lines.push("## Следующий шаг");
  lines.push('Сказать «**неделя 1**» — выдам задание по первой теме.');
  lines.push('Или «**спланируй сегодня**» — `node scripts/daily-plan.mjs --user <key>`.');

  return lines.join("\n") + "\n";
}

export function buildStudyPlan(profile, today = todayISO()) {
  const topics = getTopicsFromProfile(profile);
  if (!topics.length) {
    return { error: "no topics in profile" };
  }

  const deadline = profile.deadline;
  let totalWeeks = 12;
  if (deadline) {
    const d = deadline.length === 7 ? `${deadline}-01` : deadline;
    totalWeeks = weeksBetween(today, d) || 12;
  }
  totalWeeks = Math.max(1, totalWeeks);

  const hpw = Number(profile.hours_per_week) || 7;
  const totalHours = Math.round(hpw * totalWeeks);

  const { topics: allocated, finalBlock } = allocateHours(
    topics,
    totalHours,
    profile,
    today
  );
  const rows = assignWeeks(allocated, totalWeeks, hpw);

  const markdown = renderPlanMarkdown(profile, rows, finalBlock, {
    totalHours,
    totalWeeks,
    today,
  });

  return {
    markdown,
    meta: { totalHours, totalWeeks, topicCount: rows.length },
    rows,
  };
}
