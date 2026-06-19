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
// hallucinations Whisper/Gemma emit on silence here. The match is against the
// WHOLE transcription result, not individual segments: a result that is exactly
// "はい" (or "ありがとうございました。") is dropped, but the same word appearing
// as part of a longer response ("はい、そうです") is kept. The ご視聴/ご清聴
// entries are the YouTube-style sign-offs hallucinated over silence.
const HALLUCINATION_PHRASES = new Set([
  'thankyou',
  'okay',
  'はい',
  'ありがとうございました',
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ご清聴ありがとうございました',
  'ご清聴ありがとうございます',
]);

function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿가-힯]/gi, '');
}

/** 発話文字を含むか（含まなければ句読点/記号のみ＝無音）。 */
function hasSpeech(text: string): boolean {
  return HAS_SPEECH_CHAR.test(text);
}

/**
 * 文字起こし「結果全体」がハルシネーションだけか判定する。ハルシネーション語の照合は
 * 全文の完全一致のみ（会話の一部に同じ語が混ざっていても落とさない）。無音（発話文字なし）
 * もここで弾く。
 */
function isHallucinationOnly(text: string): boolean {
  if (!hasSpeech(text)) return true; // punctuation/symbols only -> silence
  return HALLUCINATION_PHRASES.has(normalizePhrase(text));
}

/** セグメント列から発話だけを連結して返す。 */
export function speechText(data: { text?: string; segments?: WhisperSegment[] }): string {
  const segments = data.segments;
  // まず本文を組み立てる。セグメントがあれば無音（句読点のみ）セグメントだけ捨てて連結する。
  // ハルシネーション語の除去はセグメント単位では行わない（会話の一部なら残す）。
  const text =
    segments == null || segments.length === 0
      ? (data.text ?? '').trim()
      : segments
          .map((s) => (s.text ?? '').trim())
          .filter((t) => t.length > 0 && hasSpeech(t))
          .join(' ')
          .trim();
  // 組み立てた全文が「ハルシネーション語そのもの」または無音なら捨てる。
  return isHallucinationOnly(text) ? '' : text;
}
