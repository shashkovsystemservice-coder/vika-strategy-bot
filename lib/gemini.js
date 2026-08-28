import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

function normalizeMimeType(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  if (!value || value === 'application/octet-stream' || value === 'binary/octet-stream') return 'audio/ogg';
  if (value.includes('ogg')) return 'audio/ogg';
  if (value.includes('mpeg') || value.includes('mp3')) return 'audio/mpeg';
  if (value.includes('wav')) return 'audio/wav';
  if (value.includes('m4a') || value.includes('mp4')) return 'audio/mp4';
  return mimeType;
}

function extensionFor(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'm4a';
  return 'ogg';
}

export async function transcribeAudio(buffer, mimeType = 'audio/ogg') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const normalizedMimeType = normalizeMimeType(mimeType);
  const client = new GoogleGenAI({ apiKey });
  const tempPath = `/tmp/vika-${randomUUID()}.${extensionFor(normalizedMimeType)}`;
  let uploadedFile = null;
  await writeFile(tempPath, buffer);

  try {
    uploadedFile = await client.files.upload({
      file: tempPath,
      config: { mimeType: normalizedMimeType },
    });

    const interaction = await client.interactions.create({
      model: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
      input: [
        {
          type: 'audio',
          uri: uploadedFile.uri,
          mime_type: normalizedMimeType,
        },
      ],
      generation_config: {
        transcription_config: {
          language_codes: ['ru-RU'],
          custom_vocabulary: [
            'IBA', 'IBA Wellness', 'wellness', 'boxing', 'fit-box',
            'premium', 'middle plus', 'performance', 'recovery', 'wellness club',
          ],
          mode: { type: 'verbatim' },
        },
      },
    });

    const transcript = interaction.output_text?.trim();
    if (!transcript) throw new Error('Gemini returned an empty transcript');
    return transcript;
  } finally {
    await unlink(tempPath).catch(() => {});
    if (uploadedFile?.name) {
      await client.files.delete({ name: uploadedFile.name }).catch(() => {});
    }
  }
}
