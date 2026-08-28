const DEFAULT_REPO = 'shashkovsystemservice-coder/vika-strategy-bot';
const DEFAULT_ISSUE = 1;
const MARKER_START = '<!-- VIKA_STRATEGY_ANSWER';
const MARKER_END = '-->';

function config() {
  return {
    token: process.env.GITHUB_WRITE_TOKEN,
    repo: process.env.GITHUB_REPO || DEFAULT_REPO,
    issueNumber: Number(process.env.GITHUB_ANSWERS_ISSUE_NUMBER || DEFAULT_ISSUE),
  };
}

function headers(withJson = false) {
  const { token } = config();
  const result = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vika-strategy-bot',
  };
  if (token) result.Authorization = `Bearer ${token}`;
  if (withJson) result['Content-Type'] = 'application/json';
  return result;
}

function parseRecord(body = '') {
  const start = body.indexOf(MARKER_START);
  if (start < 0) return null;
  const jsonStart = body.indexOf('\n', start);
  if (jsonStart < 0) return null;
  const end = body.indexOf(MARKER_END, jsonStart);
  if (end < 0) return null;
  try {
    return JSON.parse(body.slice(jsonStart + 1, end).trim());
  } catch {
    return null;
  }
}

async function fetchAllComments() {
  const { repo, issueNumber } = config();
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`;
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) throw new Error(`GitHub comments read failed: ${response.status} ${await response.text()}`);
    const batch = await response.json();
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

export async function readAnswerStore() {
  const comments = await fetchAllComments();
  const respondents = {};

  for (const comment of comments) {
    const record = parseRecord(comment.body);
    if (!record?.telegram_user_id || !record?.question_id) continue;
    const key = String(record.telegram_user_id);
    const respondent = respondents[key] || {
      telegram_user_id: record.telegram_user_id,
      username: record.username || null,
      display_name: record.display_name || null,
      started_at: record.answered_at,
      updated_at: record.answered_at,
      responses: {},
    };
    respondent.updated_at = record.answered_at || respondent.updated_at;
    respondent.responses[record.question_id] = {
      status: record.status,
      answer_type: record.answer_type,
      transcript: record.transcript || '',
      answered_at: record.answered_at,
      telegram_message_id: record.telegram_message_id ?? null,
      question_snapshot: record.question_snapshot,
      github_comment_id: comment.id,
      github_comment_url: comment.html_url,
    };
    respondents[key] = respondent;
  }

  return { data: { version: '1.0.0', project: 'IBA Wellness', respondents } };
}

export async function getRespondent(userId) {
  const { data } = await readAnswerStore();
  return data.respondents?.[String(userId)] ?? null;
}

function buildCommentBody(record) {
  const readableTranscript = record.status === 'skipped' ? '_Вопрос пропущен._' : record.transcript;
  return `${MARKER_START}\n${JSON.stringify(record)}\n${MARKER_END}\n\n### ${record.question_id} — ${record.status}\n\n**${record.question_snapshot.stage} — ${record.question_snapshot.block}**\n\n${record.question_snapshot.question}\n\n**Ответ (${record.answer_type}):**\n\n${readableTranscript}`;
}

export async function saveResponse({ user, question, status = 'answered', answerType, transcript = '', telegramMessageId }) {
  const { token, repo, issueNumber } = config();
  if (!token) throw new Error('GITHUB_WRITE_TOKEN is not configured');

  const { data } = await readAnswerStore();
  const existing = data.respondents?.[String(user.id)]?.responses ?? {};

  // Telegram can occasionally retry a webhook. Do not save the same Telegram message twice.
  const duplicate = Object.values(existing).find((r) => r.telegram_message_id === telegramMessageId);
  if (duplicate) return data.respondents[String(user.id)];

  const now = new Date().toISOString();
  const record = {
    schema: '1.0.0',
    telegram_user_id: user.id,
    username: user.username || null,
    display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
    question_id: question.id,
    status,
    answer_type: answerType,
    transcript,
    answered_at: now,
    telegram_message_id: telegramMessageId ?? null,
    question_snapshot: {
      id: question.id,
      stage: question.stage,
      block: question.block,
      question: question.question,
    },
  };

  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`;
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ body: buildCommentBody(record) }),
  });
  if (!response.ok) throw new Error(`GitHub comment write failed: ${response.status} ${await response.text()}`);

  // Return an in-memory respondent including the new response so the caller can immediately move to the next question.
  const respondent = data.respondents?.[String(user.id)] || {
    telegram_user_id: user.id,
    username: record.username,
    display_name: record.display_name,
    started_at: now,
    responses: {},
  };
  respondent.updated_at = now;
  respondent.responses ||= {};
  respondent.responses[question.id] = {
    status,
    answer_type: answerType,
    transcript,
    answered_at: now,
    telegram_message_id: telegramMessageId ?? null,
    question_snapshot: record.question_snapshot,
  };
  return respondent;
}
