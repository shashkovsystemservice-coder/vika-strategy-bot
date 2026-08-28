import fs from 'node:fs';

export function loadQuestionnaire() {
  const raw = fs.readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw);
  const questions = data.questions
    .map((q, index) => ({ ...q, _order: Number.isFinite(q.order) ? q.order : index + 1 }))
    .sort((a, b) => a._order - b._order || a.id.localeCompare(b.id));
  return { ...data, questions };
}

function isCompleted(response) {
  return response?.status === 'answered' || response?.status === 'skipped';
}

export function getNextQuestion(questionnaire, respondent) {
  const responses = respondent?.responses ?? {};
  return questionnaire.questions.find((q) => !isCompleted(responses[q.id]));
}

export function getCurrentQuestion(questionnaire, respondent) {
  return getNextQuestion(questionnaire, respondent) ?? null;
}

export function getProgress(questionnaire, respondent) {
  const responses = respondent?.responses ?? {};
  const completed = questionnaire.questions.filter((q) => isCompleted(responses[q.id])).length;
  return {
    completed,
    total: questionnaire.questions.length,
    percent: questionnaire.questions.length ? Math.round((completed / questionnaire.questions.length) * 100) : 0,
  };
}

export function formatQuestion(questionnaire, question, respondent) {
  const index = questionnaire.questions.findIndex((q) => q.id === question.id);
  const existing = respondent?.responses?.[question.id];
  const fragments = existing?.fragments?.length ?? 0;
  const context = question.known ? `\n\nЧто уже известно / рабочая база:\n${question.known}` : '';
  const continuation = fragments
    ? `\n\nУже сохранено частей ответа: ${fragments}. Можно прислать ещё голосовое или текст.`
    : '';
  return `Вопрос ${index + 1} из ${questionnaire.questions.length} · ${question.id}\n${question.stage} — ${question.block}\n\n${question.question}${context}${continuation}\n\nОтветь голосовым сообщением или текстом. Я буду накапливать все сообщения как один ответ.\n/done — закончить ответ и перейти дальше · /skip — пропустить · /progress — прогресс · /repeat — повторить вопрос`;
}
