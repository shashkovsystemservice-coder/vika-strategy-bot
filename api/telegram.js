import { waitUntil } from '@vercel/functions';
import { loadQuestionnaire, getCurrentQuestion, getProgress, formatQuestion } from '../lib/questions.js';
import { readAnswerStore, appendAnswerFragment, finalizeAnswer, skipQuestion } from '../lib/github-store.js';
import { getTelegramFile, sendMessage } from '../lib/telegram.js';
import { transcribeAudio } from '../lib/gemini.js';

function isAllowed(userId) {
  const allowed = process.env.ALLOWED_TELEGRAM_USER_ID;
  if (!allowed) return true;
  return String(userId) === String(allowed);
}

function verifyWebhook(req) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return true;
  return req.headers['x-telegram-bot-api-secret-token'] === secret;
}

async function loadRespondent(userId) {
  const { data } = await readAnswerStore();
  return data.respondents?.[String(userId)] ?? null;
}

async function sendCurrent(chatId, userId) {
  const questionnaire = loadQuestionnaire();
  const respondent = await loadRespondent(userId);
  const question = getCurrentQuestion(questionnaire, respondent);
  if (!question) {
    await sendMessage(chatId, `Все ${questionnaire.questions.length} вопросов пройдены. Спасибо.`);
    return;
  }
  await sendMessage(chatId, formatQuestion(questionnaire, question, respondent));
}

async function sendProgress(chatId, userId) {
  const questionnaire = loadQuestionnaire();
  const respondent = await loadRespondent(userId);
  const progress = getProgress(questionnaire, respondent);
  const current = getCurrentQuestion(questionnaire, respondent);
  const fragments = current ? (respondent?.responses?.[current.id]?.fragments?.length ?? 0) : 0;
  const extra = fragments ? ` Сейчас на ${current.id} накоплено частей ответа: ${fragments}.` : '';
  await sendMessage(chatId, `Пройдено: ${progress.completed} из ${progress.total} (${progress.percent}%).${extra}`);
}

function cleanCommand(text = '') {
  return text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
}

async function processMessage(message) {
  if (!message?.from || !message?.chat) return;

  const user = message.from;
  const chatId = message.chat.id;

  try {
    if (!isAllowed(user.id)) {
      await sendMessage(chatId, 'Этот бот сейчас работает в закрытом режиме.');
      return;
    }

    const text = message.text?.trim() || '';
    const command = text.startsWith('/') ? cleanCommand(text) : null;

    if (command === '/whoami') {
      await sendMessage(chatId, `Твой Telegram user ID: ${user.id}`);
      return;
    }

    if (command === '/start') {
      await sendMessage(chatId, 'Это стратегический опросник IBA Wellness. Я задаю вопросы по одному. На один вопрос можно отправить несколько голосовых и текстовых сообщений. Когда ответ закончен — /done.');
      await sendCurrent(chatId, user.id);
      return;
    }

    if (command === '/progress') {
      await sendProgress(chatId, user.id);
      return;
    }

    if (command === '/repeat' || command === '/next') {
      await sendCurrent(chatId, user.id);
      return;
    }

    const questionnaire = loadQuestionnaire();
    const respondent = await loadRespondent(user.id);
    const question = getCurrentQuestion(questionnaire, respondent);

    if (!question) {
      await sendMessage(chatId, 'Опрос уже завершён. Новые вопросы появятся автоматически, если мы добавим их в проект.');
      return;
    }

    if (command === '/skip') {
      const updated = await skipQuestion({ user, question, telegramMessageId: message.message_id });
      await sendMessage(chatId, `Пропущено: ${question.id}.`);
      const next = getCurrentQuestion(questionnaire, updated);
      if (next) await sendMessage(chatId, formatQuestion(questionnaire, next, updated));
      else await sendMessage(chatId, 'Все вопросы пройдены.');
      return;
    }

    if (command === '/done') {
      const updated = await finalizeAnswer({ user, question });
      const combined = updated.responses?.[question.id]?.transcript || '';
      const preview = combined.length > 1600 ? `${combined.slice(0, 1600)}…` : combined;
      await sendMessage(chatId, `Ответ на ${question.id} завершён.\n\nИтоговый текст из всех частей:\n${preview}`);
      const next = getCurrentQuestion(questionnaire, updated);
      if (next) await sendMessage(chatId, formatQuestion(questionnaire, next, updated));
      else await sendMessage(chatId, 'Все текущие вопросы пройдены. Если в проект добавятся новые вопросы, бот увидит их после следующего обновления.');
      return;
    }

    let transcript;
    let answerType;

    if (message.voice) {
      const maxSeconds = Number(process.env.MAX_VOICE_SECONDS || 600);
      if (message.voice.duration > maxSeconds) {
        await sendMessage(chatId, `Голосовое слишком длинное. Максимум сейчас ${Math.floor(maxSeconds / 60)} мин.`);
        return;
      }
      const currentParts = respondent?.responses?.[question.id]?.fragments?.length ?? 0;
      await sendMessage(chatId, `Получил часть ${currentParts + 1} ответа на ${question.id}. Расшифровываю…`);
      const file = await getTelegramFile(message.voice.file_id);
      transcript = await transcribeAudio(file.buffer, file.contentType || message.voice.mime_type || 'audio/ogg');
      answerType = 'voice';
    } else if (text && !text.startsWith('/')) {
      transcript = text;
      answerType = 'text';
    } else {
      await sendMessage(chatId, 'Ответь голосовым сообщением или текстом. Можно прислать несколько частей. Когда закончишь — /done.');
      return;
    }

    const updated = await appendAnswerFragment({
      user,
      question,
      answerType,
      transcript,
      telegramMessageId: message.message_id,
    });

    const count = updated?.responses?.[question.id]?.fragments?.length ?? 1;
    const preview = transcript.length > 900 ? `${transcript.slice(0, 900)}…` : transcript;
    await sendMessage(chatId, `Часть ${count} сохранена для ${question.id}.\n\n${preview}\n\nМожешь добавить ещё голосовое или текст. Когда ответ закончен — /done.`);
  } catch (error) {
    console.error(error);
    try {
      await sendMessage(chatId, 'Не удалось обработать ответ. Ошибка записана в журнал Vercel. Попробуй ещё раз позже.');
    } catch (sendError) {
      console.error(sendError);
    }
  }
}

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!verifyWebhook(req)) return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });

  const message = req.body?.message;
  if (message) waitUntil(processMessage(message));

  return res.status(200).json({ ok: true });
}
