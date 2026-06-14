import { Platform } from 'react-native';
import { absoluteUri, readBytes } from '../../../data';
import { getGroqApiKey, hasGroqApiKey } from '../groqKey';
import type { TranscriptionProvider } from '../types';
import { speechText, type WhisperSegment } from './speech';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';

/** catalog / settings に保存する安定 ref。 */
export const GROQ_WHISPER_REF = 'groq:whisper-large-v3-turbo';

/**
 * Transcribe a stored audio file (relative path under the app's document
 * directory) with Groq Whisper.
 *
 * React Native cannot construct a `Blob` from raw bytes, so on native we hand
 * Groq the file's `file://` URI via FormData's `{ uri, name, type }` form; on
 * web we read the bytes back and wrap them in a `Blob`. Either way the upload
 * is multipart/form-data, so `fetch` derives the boundary itself.
 */
async function transcribeWithGroq(relativePath: string, language?: string): Promise<string> {
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
  form.append('model', GROQ_WHISPER_MODEL);
  // verbose_json gives per-segment text, which we use to drop silence
  // (Whisper otherwise hallucinates phrases like "Thank you." onto silence).
  form.append('response_format', 'verbose_json');
  if (language) {
    form.append('language', language);
  }

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getGroqApiKey()}`,
    },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq transcription failed: ${response.status} ${detail}`.trim());
  }
  const data = (await response.json()) as { text?: string; segments?: WhisperSegment[] };
  return speechText(data);
}

/** クラウド（Groq Whisper）プロバイダ。 */
export const groqWhisperProvider: TranscriptionProvider = {
  model: GROQ_WHISPER_REF,
  kind: 'cloud',
  isAvailable: () => hasGroqApiKey(),
  transcribe: (relativePath, opts) => transcribeWithGroq(relativePath, opts?.language),
};
