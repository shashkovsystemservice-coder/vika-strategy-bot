import questionnaire from '../data/questions.json' with { type: 'json' };

export default function handler(req, res) {
  const { stage, priority, id } = req.query ?? {};

  let questions = questionnaire.questions;

  if (id) {
    const question = questions.find((item) => item.id === id);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    return res.status(200).json({ version: questionnaire.version, project: questionnaire.project, question });
  }

  if (stage) questions = questions.filter((item) => item.stage === stage);
  if (priority) questions = questions.filter((item) => item.priority === priority);

  return res.status(200).json({
    version: questionnaire.version,
    project: questionnaire.project,
    total: questions.length,
    questions
  });
}
