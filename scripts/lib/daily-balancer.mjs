// daily-balancer — assemble balanced day from weighted candidates.

import { sortByPriority } from "./task-weighting.mjs";
import { formatDateTime, addMinutes } from "./dates.mjs";

const SLOT_START = { morning: 10, afternoon: 14, evening: 18 };

function slotForDifficulty(d) {
  if (d >= 4) return "morning";
  if (d >= 3) return "afternoon";
  return "evening";
}

function canAddBlock(selected, candidate) {
  const sum = selected.reduce((s, x) => s + x.eff_difficulty, 0);
  if (sum + candidate.eff_difficulty > candidate._budget) return false;

  const count5 = selected.filter((x) => x.eff_difficulty >= 5).length;
  if (candidate.eff_difficulty >= 5 && count5 >= 1) return false;

  const heavy = selected.filter((x) => x.eff_difficulty >= 4);
  if (candidate.eff_difficulty >= 4 && heavy.length >= 2) return false;

  if (heavy.length && candidate.eff_difficulty >= 4) {
    const last = selected[selected.length - 1];
    if (last && last.eff_difficulty >= 4) return false;
  }

  return true;
}

function needsLightBuffer(selected) {
  const hasHeavy = selected.some((x) => x.eff_difficulty >= 4);
  const hasLight = selected.some((x) => x.eff_difficulty <= 2);
  return hasHeavy && !hasLight;
}

export function balanceDay(candidates, budget, date) {
  const sorted = sortByPriority(
    candidates.map((c) => ({ ...c, _budget: budget }))
  ).sort((a, b) => {
    if (b.eff_priority !== a.eff_priority) return 0;
    return b.eff_difficulty - a.eff_difficulty;
  });
  const selected = [];
  const deferred = [];

  for (const c of sorted) {
    if (selected.includes(c)) continue;
    if (canAddBlock(selected, c)) {
      selected.push(c);
      continue;
    }
    if (c.eff_difficulty >= 4) {
      const lightPending = sorted.find(
        (x) =>
          !selected.includes(x) &&
          !deferred.includes(x) &&
          x.eff_difficulty <= 2 &&
          canAddBlock(selected, x)
      );
      if (lightPending) selected.push(lightPending);
      if (canAddBlock(selected, c)) {
        selected.push(c);
        continue;
      }
    }
    deferred.push(c);
  }

  if (needsLightBuffer(selected)) {
    const light = deferred.find((x) => x.eff_difficulty <= 2);
    if (light && canAddBlock(selected, light)) {
      selected.push(light);
      deferred.splice(deferred.indexOf(light), 1);
    } else if (!deferred.some((x) => x.eff_difficulty <= 2)) {
      selected.push({
        title: "Карточки: повтор формул и опорных фактов",
        eff_priority: 3,
        eff_difficulty: 2,
        est_minutes: 20,
        kind: "buffer",
        tag: "buffer",
        _budget: budget,
      });
    }
  }

  const bySlot = { morning: [], afternoon: [], evening: [] };
  for (const t of selected) {
    bySlot[slotForDifficulty(t.eff_difficulty)].push(t);
  }

  for (const k of Object.keys(bySlot)) {
    bySlot[k].sort((a, b) => b.eff_priority - a.eff_priority);
  }

  const ordered = [
    ...bySlot.morning,
    ...bySlot.afternoon,
    ...bySlot.evening,
  ];

  let cursor = formatDateTime(date, SLOT_START.morning);
  const scheduled = ordered.map((t, i) => {
    const slot = slotForDifficulty(t.eff_difficulty);
    if (i === 0 || slot !== slotForDifficulty(ordered[i - 1]?.eff_difficulty)) {
      cursor = formatDateTime(date, SLOT_START[slot]);
    }
    const at = cursor;
    cursor = addMinutes(cursor, t.est_minutes);
    const { _budget, ...rest } = t;
    return {
      ...rest,
      scheduled_at: at,
      slot,
    };
  });

  const sum_difficulty = scheduled.reduce((s, x) => s + x.eff_difficulty, 0);

  return {
    tasks: scheduled,
    deferred: deferred.map(({ _budget, ...r }) => r),
    load: { sum_difficulty, budget },
  };
}

export function buildGoalId(topicTitle, purpose) {
  const slug = topicTitle
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "_")
    .slice(0, 24);
  return `g_${purpose || "study"}_${slug}`;
}
