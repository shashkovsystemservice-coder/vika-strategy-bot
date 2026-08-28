import { loadQuestionnaire, getCurrentQuestion, getProgress, formatQuestion } from '../lib/questions.js';
import { readAnswerStore, saveResponse } from '../lib/github-store.js';
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
  await sendMessage(chatId, `Пройдено: ${progress.completed} из ${progress.total} (${progress.percent}%).`);
}

function cleanCommand(text = '') {
  return text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!verifyWebhook(req)) return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });

  // Telegram expects a fast 200. The actual processing still happens during this invocation.
  res.status(200).json({ ok: true });

  const message = req.body?.message;
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
      await sendMessage(chatId, 'Это стратегический опросник IBA Wellness. Я задаю вопросы по одному. Можно отвечать голосом или текстом.');
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
      const updated = await saveResponse({
        user,
        question,
        status: 'skipped',
        answerType: 'skip',
        transcript: '',
        telegramMessageId: message.message_id,
      });
      await sendMessage(chatId, `Пропущено: ${question.id}.`);
      const next = getCurrentQuestion(questionnaire, updated);
      if (next) await sendMessage(chatId, formatQuestion(questionnaire, next, updated));
      else await sendMessage(chatId, 'Все вопросы пройдены.');
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
      await sendMessage(chatId, `Получил голосовой ответ на ${question.id}. Расшифровываю…`);
      const file = await getTelegramFile(message.voice.file_id);
      transcript = await transcribeAudio(file.buffer, file.contentType || message.voice.mime_type || 'audio/ogg');
      answerType = 'voice';
    } else if (text && !text.startsWith('/')) {
      transcript = text;
      answerType = 'text';
    } else {
      await sendMessage(chatId, 'Ответь на текущий вопрос голосовым сообщением или обычным текстом.');
      return;
    }

    const updated = await saveResponse({
      user,
      question,
      status: 'answered',
      answerType,
      transcript,
      telegramMessageId: message.message_id,
    });

    const preview = transcript.length > 1000 ? `${transcript.slice(0, 1000)}…` : transcript;
    await sendMessage(chatId, `Сохранено: ${question.id}\n\nРасшифровка:\n${preview}`);

    const next = getCurrentQuestion(questionnaire, updated);
    if (next) await sendMessage(chatId, formatQuestion(questionnaire, next, updated));
    else await sendMessage(chatId, 'Все текущие вопросы пройдены. Если в проект добавятся новые вопросы, бот увидит их после следующего обновления.');
  } catch (error) {
    console.error(error);
    try {
      await sendMessage(chatId, `Не удалось обработать ответ. ${error.message}`);
    } catch (sendError) {
      console.error(sendError);
    }
  }
}
