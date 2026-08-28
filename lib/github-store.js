const DEFAULT_REPO = 'shashkovsystemservice-coder/vika-strategy-bot';
const DEFAULT_PATH = 'data/answers.json';

function config() {
  return {
    token: process.env.GITHUB_WRITE_TOKEN,
    repo: process.env.GITHUB_REPO || DEFAULT_REPO,
    branch: process.env.GITHUB_BRANCH || 'main',
    path: process.env.GITHUB_ANSWERS_PATH || DEFAULT_PATH,
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

function decodeBase64(value) {
  return Buffer.from(value.replace(/\n/g, ''), 'base64').toString('utf8');
}

export async function readAnswerStore() {
  const { repo, branch, path } = config();
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`GitHub read failed: ${response.status} ${await response.text()}`);
  const file = await response.json();
  return { data: JSON.parse(decodeBase64(file.content)), sha: file.sha };
}

async function writeAnswerStore(data, sha) {
  const { token, repo, branch, path } = config();
  if (!token) throw new Error('GITHUB_WRITE_TOKEN is not configured');
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const body = {
    message: `Save strategy answer ${new Date().toISOString()}`,
    content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64'),
    sha,
    branch,
  };
  const response = await fetch(url, {
    method: 'PUT',
    headers: headers(true),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub write failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function getRespondent(userId) {
  const { data } = await readAnswerStore();
  return data.respondents?.[String(userId)] ?? null;
}

export async function saveResponse({ user, question, status = 'answered', answerType, transcript = '', telegramMessageId }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, sha } = await readAnswerStore();
    data.respondents ||= {};
    const key = String(user.id);
    const now = new Date().toISOString();
    const respondent = data.respondents[key] || {
      telegram_user_id: user.id,
      username: user.username || null,
      display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
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
      question_snapshot: {
        id: question.id,
        stage: question.stage,
        block: question.block,
        question: question.question,
      },
    };
    data.respondents[key] = respondent;
    try {
      await writeAnswerStore(data, sha);
      return respondent;
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to save response after retries');
}
