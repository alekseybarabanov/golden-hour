// Task title templates for daily-plan (deterministic, no LLM).

const EXAM_THEORY = {
  default: (topic) => `Теория: ${topic}`,
  russian: (topic) => {
    if (/орфограф/i.test(topic)) return `Теория: правила орфографии — ${topic}`;
    if (/норм/i.test(topic)) return `Теория: языковые нормы — ${topic}`;
    return `Теория: ${topic}`;
  },
  math: (topic) => `Теория: ${topic} + разбор типовых приёмов`,
};

const EXAM_PRACTICE = {
  default: (topic) => `Практика: 4–5 заданий по теме «${topic}»`,
  math: (topic) => `Практика: 4–5 задач на «${topic}» по возрастанию сложности`,
};

export function studyBlocksForTopic(topic, profile, weekNum) {
  const subject = profile.exam_subject || profile.olympiad_subject || profile.study_subject || "";
  const purpose = profile.purpose || "exam";
  const title = topic.title || topic;
  const level = topic.level || "medium";

  const theoryFn =
    EXAM_THEORY[subject] || EXAM_THEORY.default;
  const practiceFn =
    EXAM_PRACTICE[subject] || EXAM_PRACTICE.default;

  const blocks = [];

  if (purpose === "olympiad") {
    blocks.push({
      title: `Теория + опорные задачи: ${title} (нед. ${weekNum})`,
      kind: "theory",
      est_minutes: 60,
    });
    blocks.push({
      title: `Практика: 6–8 задач — ${title}`,
      kind: "practice",
      est_minutes: 60,
      difficulty: 4,
    });
    blocks.push({
      title: `Карточки: формулы и опорные факты — ${title}`,
      kind: "cards",
      est_minutes: 30,
      difficulty: 2,
    });
    return blocks;
  }

  if (purpose === "topic") {
    blocks.push({
      title: `Изучение: ${title} — теория и примеры`,
      kind: "theory",
      est_minutes: 60,
      difficulty: 4,
    });
    blocks.push({
      title: `Закрепление: упражнения по ${title}`,
      kind: "practice",
      est_minutes: 45,
      difficulty: 3,
    });
    return blocks;
  }

  // exam (default)
  blocks.push({
    title: theoryFn(title),
    kind: "theory",
    est_minutes: 90,
    difficulty: 4,
  });
  blocks.push({
    title: `Карточки: ключевые правила — ${title}`,
    kind: "cards",
    est_minutes: 30,
    difficulty: 2,
  });
  blocks.push({
    title: practiceFn(title),
    kind: "practice",
    est_minutes: 90,
    difficulty: 4,
  });

  return blocks;
}

export function weekSkeletonLine(planText, weekNum) {
  const re = new RegExp(
    `\\*\\*Нед\\.?\\s*${weekNum}[^*]*\\*\\*\\s*[—–-]\\s*\\*\\*([^*]+)\\*\\*`,
    "i"
  );
  const m = planText.match(re);
  if (m) return m[1].trim();
  const range = planText.match(
    new RegExp(`Нед\\.?\\s*${weekNum}[–\\-][^—]+—\\s*\\*\\*([^*]+)\\*\\*`, "i")
  );
  return range ? range[1].trim() : null;
}
