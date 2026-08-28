import fs from 'node:fs';

const raw = fs.readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);

if (!Array.isArray(data.questions) || data.questions.length === 0) {
  throw new Error('Questionnaire must contain questions');
}

const ids = new Set();
for (const q of data.questions) {
  for (const key of ['id', 'stage', 'block', 'question', 'priority']) {
    if (!q[key]) throw new Error(`Missing ${key} in ${q.id ?? 'unknown question'}`);
  }
  if (ids.has(q.id)) throw new Error(`Duplicate question id: ${q.id}`);
  ids.add(q.id);
}

console.log(`OK: ${data.questions.length} questions, version ${data.version}`);
