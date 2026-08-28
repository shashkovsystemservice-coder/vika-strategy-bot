export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'vika-strategy-bot',
    stage: 'mvp-code-ready',
    storage: 'github',
    transcription: 'gemini-3.5-transcribe',
    telegramWebhook: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    githubWriteConfigured: Boolean(process.env.GITHUB_WRITE_TOKEN)
  });
}
