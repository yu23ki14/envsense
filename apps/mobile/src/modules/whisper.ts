import { keys } from '../keys';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

/**
 * Transcribe an audio Blob with Groq's Whisper endpoint. `filename` is what
 * Groq uses to infer the container format -- pass e.g. `audio.ogg` for
 * Ogg-encapsulated Opus (see {@link import('./audio').opusFramesToOgg}).
 *
 * Uses the built-in `fetch` (available on web and React Native) so the
 * pipeline carries no HTTP-client dependency.
 */
export async function transcribeAudioWithGroq(
  audio: Blob,
  filename: string,
  language?: string,
): Promise<string> {
  const form = new FormData();
  // Do not set Content-Type manually: fetch derives the multipart boundary.
  form.append('file', audio, filename);
  form.append('model', MODEL);
  form.append('response_format', 'json');
  if (language) {
    form.append('language', language);
  }

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${keys.groq}`,
    },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq transcription failed: ${response.status} ${detail}`.trim());
  }
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}
