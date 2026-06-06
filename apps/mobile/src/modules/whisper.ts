import { Platform } from 'react-native';
import { absoluteUri, readBytes } from '../data';
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

/**
 * Transcribe a stored audio file (relative path under the app's document
 * directory) with Groq Whisper.
 *
 * React Native cannot construct a `Blob` from raw bytes, so on native we hand
 * Groq the file's `file://` URI via FormData's `{ uri, name, type }` form; on
 * web we read the bytes back and wrap them in a `Blob`. Either way the upload
 * is multipart/form-data, so `fetch` derives the boundary itself.
 */
export async function transcribeAudioFile(
  relativePath: string,
  language?: string,
): Promise<string> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const bytes = await readBytes(relativePath);
    if (bytes == null) throw new Error(`Audio file not found: ${relativePath}`);
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/ogg' }),
      'audio.ogg',
    );
  } else {
    const part = { uri: absoluteUri(relativePath), name: 'audio.ogg', type: 'audio/ogg' };
    // biome-ignore lint/suspicious/noExplicitAny: RN's file part shape isn't a Blob
    form.append('file', part as any);
  }
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
