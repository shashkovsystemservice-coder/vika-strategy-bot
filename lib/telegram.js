function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

async function telegram(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(result)}`);
  return result.result;
}

export async function sendMessage(chatId, text, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function getTelegramFile(fileId) {
  const file = await telegram('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${botToken()}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    path: file.file_path,
    contentType: response.headers.get('content-type') || 'audio/ogg',
  };
}

export async function setWebhook(url) {
  const payload = {
    url,
    allowed_updates: ['message'],
  };
  if (process.env.TELEGRAM_WEBHOOK_SECRET) payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
  return telegram('setWebhook', payload);
}
