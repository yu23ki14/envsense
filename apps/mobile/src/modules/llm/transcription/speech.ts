/**
 * Whisper 出力の後処理（無音・ハルシネーション除去）。Whisper 系エンジン共通の
 * 純ロジックなので、クラウド（Groq）でもローカル（whisper.cpp）でも使える。
 */

export type WhisperSegment = { text?: string };

// Whisper's no_speech_prob / avg_logprob / compression_ratio don't separate
// silence from speech here (Groq reports no_speech_prob ≈ 0 even on silence),
// but the *text* does: silence yields punctuation-only segments (".") or one of
// a couple of stock hallucination phrases. Filter on that instead.
const HAS_SPEECH_CHAR = /[a-z0-9぀-ヿ一-鿿가-힯]/i;
// Only drop these exact phrases (case/punctuation-insensitive) — they're the
// hallucinations Whisper emits on silence here. Keep the list tight so real
// short utterances aren't lost. The Japanese entries are the YouTube-style
// sign-offs Whisper hallucinates over silence ("ご視聴ありがとうございました"
// など); we keep the ご視聴/ご清聴 variants but deliberately *not* bare
// "ありがとうございました", which is a real utterance.
const HALLUCINATION_PHRASES = new Set([
  'thankyou',
  'okay',
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ご清聴ありがとうございました',
  'ご清聴ありがとうございます',
]);

function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿가-힯]/gi, '');
}

function isNonSpeech(text: string): boolean {
  if (!HAS_SPEECH_CHAR.test(text)) return true; // punctuation/symbols only -> silence
  return HALLUCINATION_PHRASES.has(normalizePhrase(text));
}

/** セグメント列から発話だけを連結して返す。 */
export function speechText(data: { text?: string; segments?: WhisperSegment[] }): string {
  const segments = data.segments;
  if (segments == null || segments.length === 0) {
    // No segment metadata (e.g. on-device engines that return a single text).
    // Still apply the silence/hallucination filter so silent segments don't get saved.
    const text = (data.text ?? '').trim();
    return isNonSpeech(text) ? '' : text;
  }
  return segments
    .map((s) => (s.text ?? '').trim())
    .filter((t) => t.length > 0 && !isNonSpeech(t))
    .join(' ')
    .trim();
}
