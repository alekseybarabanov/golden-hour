// Onboarding step detection (shared by session-start.mjs and tests).

function hasNonEmptyList(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function hasNonEmptyMap(value) {
  if (value == null) return false;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value).length > 0;
  }
  return !!value;
}

export function hasExamTopics(profile) {
  return hasNonEmptyList(profile?.exam_topics);
}

export function hasExamTopicLevels(profile) {
  return hasNonEmptyMap(profile?.exam_topic_levels);
}

export function hasOlympiadLevel(profile) {
  if (profile.olympiad_level || profile.olympiad_level_note) return true;
  return hasNonEmptyMap(profile.olympiad_levels);
}

export function hasTopicLevel(profile) {
  if (profile.topic_level) return true;
  return hasNonEmptyMap(profile.topic_sublevels);
}

export function hasDeadline(profile) {
  return profile.deadline !== undefined;
}

/** Next incomplete onboarding step, or null if ready for setup-finalize completion. */
export function detectCurrentStep(profile) {
  if (!profile?.name) return { step: 1, name: "hello-intro", field: "name" };
  if (!profile.purpose) return { step: 2, name: "purpose-select", field: "purpose" };

  if (profile.purpose === "exam") {
    if (!profile.exam_type) return { step: 3, name: "exam-type", field: "exam_type" };
    if (!profile.exam_subject) return { step: 4, name: "exam-subject", field: "exam_subject" };
    if (!hasExamTopics(profile)) return { step: 5, name: "exam-topics", field: "exam_topics" };
    if (!hasExamTopicLevels(profile)) {
      if (profile.onboarding_mode === "quick" && hasExamTopics(profile)) {
        // quick mode: levels filled by exam-topics.mjs / onboarding-quick.mjs
      } else {
        return { step: 6, name: "exam-self-assess", field: "exam_topic_levels" };
      }
    }
  } else if (profile.purpose === "olympiad") {
    if (!profile.grade) return { step: 3, name: "olympiad-grade", field: "grade" };
    if (!profile.olympiad_subject) {
      return { step: 4, name: "olympiad-subject", field: "olympiad_subject" };
    }
    if (!hasOlympiadLevel(profile)) {
      return { step: 5, name: "olympiad-self-assess", field: "olympiad_level" };
    }
  } else if (profile.purpose === "topic") {
    if (!profile.study_topic) return { step: 3, name: "topic-clarify", field: "study_topic" };
    if (!hasTopicLevel(profile)) {
      return { step: 4, name: "topic-self-assess", field: "topic_level" };
    }
  }

  if (!hasDeadline(profile)) {
    return { step: 7, name: "setup-finalize", field: "deadline" };
  }
  if (profile.hours_per_week == null || profile.hours_per_week === "") {
    return { step: 7, name: "setup-finalize", field: "hours_per_week" };
  }
  if (!profile.priorities) {
    return { step: 7, name: "setup-finalize", field: "priorities" };
  }
  if (!profile.daily_load) {
    return { step: 7, name: "setup-finalize", field: "daily_load" };
  }
  // theme опционален — default dark (SOUL.md); не блокирует завершение

  return null;
}

export function getOnboardingPrompt(step) {
  if (!step) return null;
  const prompts = {
    "hello-intro":
      "Как тебя зовут? И что изучаем — экзамен, олимпиада или тему? (или «быстрый старт» — минимум вопросов)",
    "purpose-select": "Зачем тебе бот: 1) Экзамен 2) Олимпиада 3) Тема",
    "exam-type": "Какой экзамен: ЕГЭ, ОГЭ, вступительные или другой?",
    "exam-subject": "Какой предмет?",
    "exam-topics":
      "По каким темам готовимся? Список, «все из кодификатора» или: node scripts/exam-topics.mjs apply --user <key> --exam-type ...",
    "exam-self-assess": "Оцени уровень по каждой теме: с нуля / слабо / средне / уверенно.",
    "olympiad-grade": "В каком классе?",
    "olympiad-subject": "Какой предмет олимпиады?",
    "olympiad-self-assess": "Твой уровень по блокам предмета: новичок / средний / продвинутый.",
    "topic-clarify": "Уточни тему — что именно изучаем?",
    "topic-self-assess": "Твой уровень по этой теме?",
    "setup-finalize":
      "Дедлайн (месяц год или «без дедлайна»), часов в неделю, темп (лёгкий/обычный/интенсивный).",
  };
  if (step.field === "deadline") return prompts["setup-finalize"];
  if (step.field === "hours_per_week") return "Сколько часов в неделю готов(а) заниматься?";
  if (step.field === "priorities") return "Что важнее в приоритете? (темы 1–5)";
  if (step.field === "daily_load") return "Темп: light (щадящий) / normal / intense?";
  if (step.field === "theme") return "Карточки плана: dark или light?";
  return prompts[step.name] || `Продолжим настройку: шаг ${step.name}`;
}

export function buildOnboardingProgress(profile) {
  const filled = [];
  const missing = [];

  if (profile.name) filled.push("Имя");
  else missing.push("Имя");
  if (profile.purpose) filled.push(`Цель: ${profile.purpose}`);
  else missing.push("Цель");

  if (profile.purpose === "exam") {
    if (profile.exam_type) filled.push(`Тип: ${profile.exam_type}`);
    else missing.push("Тип экзамена");
    if (profile.exam_subject) filled.push(`Предмет: ${profile.exam_subject}`);
    else missing.push("Предмет");
    if (hasExamTopics(profile)) filled.push("Темы");
    else missing.push("Темы экзамена");
    if (hasExamTopicLevels(profile)) filled.push("Уровень по темам");
    else missing.push("Уровень по темам");
  } else if (profile.purpose === "olympiad") {
    if (profile.grade) filled.push(`Класс: ${profile.grade}`);
    else missing.push("Класс");
    if (profile.olympiad_subject) filled.push(`Предмет: ${profile.olympiad_subject}`);
    else missing.push("Предмет");
    if (hasOlympiadLevel(profile)) filled.push("Уровень");
    else missing.push("Уровень");
  } else if (profile.purpose === "topic") {
    if (profile.study_topic) filled.push(`Тема: ${profile.study_topic}`);
    else missing.push("Тема");
    if (hasTopicLevel(profile)) filled.push("Уровень");
    else missing.push("Уровень");
  }

  if (hasDeadline(profile)) {
    filled.push(
      profile.deadline == null ? "Дедлайн: без срока" : `Дедлайн: ${profile.deadline}`
    );
  } else {
    missing.push("Дедлайн");
  }
  if (profile.hours_per_week) filled.push(`Время: ${profile.hours_per_week} ч/нед`);
  else missing.push("Часов в неделю");
  if (profile.priorities) filled.push("Приоритеты");
  else missing.push("Приоритеты");
  if (profile.daily_load) filled.push(`Темп: ${profile.daily_load}`);
  else missing.push("Темп");
  filled.push(`Карточки: ${profile.theme || "dark"}`);

  return { filled, missing };
}
