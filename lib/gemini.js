import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

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

  const client = new GoogleGenAI({ apiKey });
  const tempPath = `/tmp/vika-${randomUUID()}.${extensionFor(mimeType)}`;
  let uploadedFile = null;
  await writeFile(tempPath, buffer);

  try {
    uploadedFile = await client.files.upload({
      file: tempPath,
      config: { mimeType },
    });

    const interaction = await client.interactions.create({
      model: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
      input: [
        {
          type: 'audio',
          uri: uploadedFile.uri,
          mime_type: uploadedFile.mimeType || mimeType,
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
