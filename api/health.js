export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'vika-strategy-bot',
    stage: 'questionnaire-ready'
  });
}
