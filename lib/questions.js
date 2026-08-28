import fs from 'node:fs';

export function loadQuestionnaire() {
  const raw = fs.readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw);
  const questions = data.questions
    .map((q, index) => ({ ...q, _order: Number.isFinite(q.order) ? q.order : index + 1 }))
    .sort((a, b) => a._order - b._order || a.id.localeCompare(b.id));
  return { ...data, questions };
}

export function getNextQuestion(questionnaire, respondent) {
  const responses = respondent?.responses ?? {};
  return questionnaire.questions.find((q) => !responses[q.id]);
}

export function getCurrentQuestion(questionnaire, respondent) {
  return getNextQuestion(questionnaire, respondent) ?? null;
}

export function getProgress(questionnaire, respondent) {
  const responses = respondent?.responses ?? {};
  const completed = questionnaire.questions.filter((q) => responses[q.id]).length;
  return {
    completed,
    total: questionnaire.questions.length,
    percent: questionnaire.questions.length ? Math.round((completed / questionnaire.questions.length) * 100) : 0,
  };
}

export function formatQuestion(questionnaire, question, respondent) {
  const index = questionnaire.questions.findIndex((q) => q.id === question.id);
  const progress = getProgress(questionnaire, respondent);
  const context = question.known ? `\n\nЧто уже известно / рабочая база:\n${question.known}` : '';
  return `Вопрос ${index + 1} из ${questionnaire.questions.length} · ${question.id}\n${question.stage} — ${question.block}\n\n${question.question}${context}\n\nОтветь голосовым сообщением или текстом.\n/skip — пропустить · /progress — прогресс · /repeat — повторить вопрос`;
}
