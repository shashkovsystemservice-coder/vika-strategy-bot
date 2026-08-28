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

function ensureResponse(respondent, record) {
  respondent.responses ||= {};
  respondent.responses[record.question_id] ||= {
    status: 'collecting',
    answer_type: 'mixed',
    transcript: '',
    fragments: [],
    answered_at: null,
    question_snapshot: record.question_snapshot,
  };
  return respondent.responses[record.question_id];
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
      started_at: record.created_at,
      updated_at: record.created_at,
      responses: {},
    };
    respondent.updated_at = record.created_at || respondent.updated_at;
    const response = ensureResponse(respondent, record);

    if (record.event === 'fragment') {
      response.fragments.push({
        type: record.answer_type,
        transcript: record.transcript || '',
        created_at: record.created_at,
        telegram_message_id: record.telegram_message_id ?? null,
        github_comment_id: comment.id,
        github_comment_url: comment.html_url,
      });
      response.status = 'collecting';
      response.answer_type = response.fragments.length > 1 ? 'mixed' : record.answer_type;
      response.transcript = response.fragments.map((f) => f.transcript).filter(Boolean).join('\n\n');
    } else if (record.event === 'finalize') {
      response.status = 'answered';
      response.answered_at = record.created_at;
    } else if (record.event === 'skip') {
      response.status = 'skipped';
      response.answered_at = record.created_at;
    }

    respondents[key] = respondent;
  }

  return { data: { version: '1.1.0', project: 'IBA Wellness', respondents } };
}

export async function getRespondent(userId) {
  const { data } = await readAnswerStore();
  return data.respondents?.[String(userId)] ?? null;
}

function buildCommentBody(record) {
  let readable = '';
  if (record.event === 'fragment') readable = `**Часть ответа (${record.answer_type}):**\n\n${record.transcript}`;
  if (record.event === 'finalize') readable = '**Ответ завершён. Переход к следующему вопросу.**';
  if (record.event === 'skip') readable = '_Вопрос пропущен._';
  return `${MARKER_START}\n${JSON.stringify(record)}\n${MARKER_END}\n\n### ${record.question_id} — ${record.event}\n\n**${record.question_snapshot.stage} — ${record.question_snapshot.block}**\n\n${record.question_snapshot.question}\n\n${readable}`;
}

async function appendRecord(record) {
  const { token, repo, issueNumber } = config();
  if (!token) throw new Error('GITHUB_WRITE_TOKEN is not configured');
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`;
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ body: buildCommentBody(record) }),
  });
  if (!response.ok) throw new Error(`GitHub comment write failed: ${response.status} ${await response.text()}`);
}

function baseRecord({ user, question }) {
  return {
    schema: '1.1.0',
    telegram_user_id: user.id,
    username: user.username || null,
    display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
    question_id: question.id,
    created_at: new Date().toISOString(),
    question_snapshot: {
      id: question.id,
      stage: question.stage,
      block: question.block,
      question: question.question,
    },
  };
}

export async function appendAnswerFragment({ user, question, answerType, transcript, telegramMessageId }) {
  const { data } = await readAnswerStore();
  const respondent = data.respondents?.[String(user.id)] || null;
  const existingFragments = respondent?.responses?.[question.id]?.fragments || [];
  if (existingFragments.some((f) => f.telegram_message_id === telegramMessageId)) return respondent;

  const record = {
    ...baseRecord({ user, question }),
    event: 'fragment',
    answer_type: answerType,
    transcript,
    telegram_message_id: telegramMessageId ?? null,
  };
  await appendRecord(record);
  return getRespondent(user.id);
}

export async function finalizeAnswer({ user, question }) {
  const respondent = await getRespondent(user.id);
  const response = respondent?.responses?.[question.id];
  if (!response?.fragments?.length) throw new Error('Нечего завершать: сначала пришли ответ голосом или текстом.');
  if (response.status === 'answered') return respondent;
  await appendRecord({ ...baseRecord({ user, question }), event: 'finalize' });
  return getRespondent(user.id);
}

export async function skipQuestion({ user, question, telegramMessageId }) {
  await appendRecord({
    ...baseRecord({ user, question }),
    event: 'skip',
    telegram_message_id: telegramMessageId ?? null,
  });
  return getRespondent(user.id);
}
