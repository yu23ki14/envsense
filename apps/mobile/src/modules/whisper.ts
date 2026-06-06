import { Platform } from 'react-native';
import { absoluteUri, readBytes } from '../data';
import { keys } from '../keys';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

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
  // verbose_json gives per-segment no_speech_prob, which we use to drop silence
  // (Whisper otherwise hallucinates phrases like "Thank you." onto silence).
  form.append('response_format', 'verbose_json');
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
  const data = (await response.json()) as { text?: string; segments?: WhisperSegment[] };
  return speechText(data);
}

type WhisperSegment = { text?: string };

// Whisper's no_speech_prob / avg_logprob / compression_ratio don't separate
// silence from speech here (Groq reports no_speech_prob ≈ 0 even on silence),
// but the *text* does: silence yields punctuation-only segments (".") or one of
// a couple of stock hallucination phrases. Filter on that instead.
const HAS_SPEECH_CHAR = /[a-z0-9぀-ヿ一-鿿가-힯]/i;
// Only drop these exact phrases (case/punctuation-insensitive) — they're the
// hallucinations Whisper emits on silence here. Keep the list tight so real
// short utterances aren't lost.
const HALLUCINATION_PHRASES = new Set(['thankyou', 'okay']);

function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿가-힯]/gi, '');
}

function isNonSpeech(text: string): boolean {
  if (!HAS_SPEECH_CHAR.test(text)) return true; // punctuation/symbols only -> silence
  return HALLUCINATION_PHRASES.has(normalizePhrase(text));
}

function speechText(data: { text?: string; segments?: WhisperSegment[] }): string {
  const segments = data.segments;
  if (segments == null || segments.length === 0) {
    // No segment metadata (shouldn't happen with verbose_json); fall back to text.
    return (data.text ?? '').trim();
  }
  return segments
    .map((s) => (s.text ?? '').trim())
    .filter((t) => t.length > 0 && !isNonSpeech(t))
    .join(' ')
    .trim();
}
