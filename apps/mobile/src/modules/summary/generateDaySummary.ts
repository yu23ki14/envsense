/**
 * 一日の AI サマリ生成パイプライン。文字起こし（AudioChunk）と写真から、
 * セッションごとの要約と 1 人称の日記（DaySummary）を作る。
 *
 * 処理順序は「写真説明 → セッション要約 → 日記」の map-reduce:
 * 1. 代表写真（ブレ除外・等間隔に最大 8 枚）に説明文を付ける。説明は Photo に
 *    保存（キャッシュ）するので、再生成時に vision を呼び直さない。
 * 2. セッション単位で文字起こしを要約する。ローカル Gemma は入力+出力で 4096
 *    トークンしか持てないため、一日分を一度に渡さずセッションで分割し、日記は
 *    その要約だけを材料にする（クラウドでも転送量と精度の面で有利）。
 * 3. セッション要約 + 写真説明 + 統計から日記本文とタイトルを生成する。
 *
 * プライバシー: モデルがローカルでクラウド補完がオフのとき、写真説明（クラウド
 * のみ対応）はスキップし、記録を一切端末から出さない。
 */
import { format } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import type { AudioChunk, AudioSession, DaySummary, Photo, SessionSummary } from '../../data';
import {
  getAudioChunksByIds,
  getAudioSessionsByIds,
  getPhotosByIds,
  getSettings,
  listAudioIdsForDay,
  listAudioSessionIdsForDay,
  listPhotoIdsForDay,
  saveDaySummary,
  savePhoto,
} from '../../data';
import { generateText, getTextProvider, getVisionProvider } from '../llm';

export type SummaryPhase = 'photos' | 'sessions' | 'day';
export type SummaryProgress = { phase: SummaryPhase; current: number; total: number };

/** 代表写真の上限。vision 呼び出し回数と日記プロンプトの長さの両方を抑える。 */
const PHOTO_LIMIT = 8;
// セッション 1 件に渡す文字起こしの上限（文字数）。ローカル Gemma は maxTokens=4096
// （入力+出力の総枠）なので控えめに、クラウドは余裕を持たせる。超えた分は等間隔抜粋。
const TRANSCRIPT_CHARS_LOCAL = 2000;
const TRANSCRIPT_CHARS_CLOUD = 6000;

function clock(ms: number): string {
  return format(ms, 'HH:mm');
}

function pickEvenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = (items.length - 1) / (count - 1);
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    const candidate = items[Math.round(i * step)];
    if (candidate != null) out.push(candidate);
  }
  return out;
}

/**
 * 生成結果を「1 行目 = タイトル、残り = 本文」として分解する。1 行しか返って
 * こなければ全体を本文として扱う（タイトルは呼び出し側のフォールバック）。
 */
function splitTitleBody(raw: string): { title: string; body: string } {
  const lines = raw
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) return { title: '', body: lines[0] ?? '' };
  const title = (lines[0] ?? '')
    .replace(/^#+\s*/, '')
    .replace(/^タイトル[:：]\s*/, '')
    .replace(/^[「『]/, '')
    .replace(/[」』]$/, '');
  return { title, body: lines.slice(1).join('\n') };
}

/** 行リストを合計 maxChars 以内に等間隔抜粋する。 */
function excerptLines(lines: string[], maxChars: number): { lines: string[]; excerpted: boolean } {
  const total = lines.reduce((sum, l) => sum + l.length, 0);
  if (total <= maxChars) return { lines, excerpted: false };
  const keep = Math.max(1, Math.floor((lines.length * maxChars) / total));
  return { lines: pickEvenlySpaced(lines, keep), excerpted: true };
}

function transcriptCharLimit(): number {
  const provider = getTextProvider(getSettings().summary.model);
  return provider.kind === 'local' ? TRANSCRIPT_CHARS_LOCAL : TRANSCRIPT_CHARS_CLOUD;
}

/**
 * 写真説明をクラウドに出してよいか。テキスト生成がクラウドなら記録は既に
 * クラウドへ渡るので常に可。ローカルのときはクラウド補完の設定に従う。
 */
function visionAllowed(): boolean {
  const settings = getSettings();
  const provider = getTextProvider(settings.summary.model);
  return provider.kind === 'cloud' || settings.summary.cloudFallback;
}

const PHOTO_DESCRIPTION_PROMPT =
  'この写真に写っている場面・行動・場所を日本語で 1 文（40 字以内）で説明してください。' +
  '説明文だけを出力し、前置きは付けないでください。';

/** 代表写真に説明文を付けて Photo に保存し、説明済みの写真を返す。 */
async function describePhotos(
  photos: Photo[],
  onProgress: (current: number, total: number) => void,
): Promise<Photo[]> {
  const sharp = photos.filter((p) => p.isBlurry !== true);
  const candidates = pickEvenlySpaced(sharp.length > 0 ? sharp : photos, PHOTO_LIMIT);
  const vision = getVisionProvider();
  const canDescribe = visionAllowed() && (await vision.isAvailable());

  const described: Photo[] = [];
  let done = 0;
  for (const photo of candidates) {
    if (photo.description != null) {
      described.push(photo);
    } else if (canDescribe) {
      try {
        const description = await vision.describeImage(photo.filePath, PHOTO_DESCRIPTION_PROMPT);
        if (description.length > 0) {
          const updated: Photo = {
            ...photo,
            description,
            descriptionAt: Date.now(),
            descriptionModel: vision.model,
          };
          savePhoto(updated);
          described.push(updated);
        }
      } catch (err) {
        // 1 枚の失敗で全体を止めない。説明なしの写真は日記の材料から外れるだけ。
        console.warn(`Photo description failed (${photo.id}): ${String(err)}`);
      }
    }
    done += 1;
    onProgress(done, candidates.length);
  }
  return described;
}

function sessionPrompt(
  session: AudioSession,
  transcriptLines: string[],
  excerpted: boolean,
  photoLines: string[],
): string {
  const range = `${clock(session.startedAt)}〜${clock(session.endedAt)}`;
  const parts = [
    `${range} に記録された会話の文字起こしです。ウェアラブルデバイスで生活の中を録音したものなので、断片的な発話を含みます。`,
    excerpted ? '（長いため等間隔に抜粋しています）' : '',
    '',
    transcriptLines.join('\n'),
  ];
  if (photoLines.length > 0) {
    parts.push('', '同じ時間帯に撮影された写真の説明:', photoLines.join('\n'));
  }
  parts.push(
    '',
    'この時間帯に何があったかを要約してください。出力は次の形式に従ってください:',
    '1 行目: 15 字以内の見出し',
    '2 行目以降: 2〜3 文の要約（だ・である調）',
    '見出しと要約だけを出力し、前置きや説明は付けないでください。',
  );
  return parts.filter((p) => p != null).join('\n');
}

async function summarizeSession(
  session: AudioSession,
  chunks: AudioChunk[],
  photos: Photo[],
  charLimit: number,
): Promise<SessionSummary | null> {
  const spoken = chunks.filter((c) => (c.transcript?.text ?? '').length > 0);
  if (spoken.length === 0) return null;

  const allLines = spoken.map((c) => `${clock(c.startedAt)} ${c.transcript?.text ?? ''}`);
  const { lines, excerpted } = excerptLines(allLines, charLimit);
  const photoLines = photos
    .filter(
      (p) =>
        p.description != null &&
        p.capturedAt >= session.startedAt &&
        p.capturedAt <= session.endedAt,
    )
    .map((p) => `${clock(p.capturedAt)} ${p.description}`);

  const { text } = await generateText(sessionPrompt(session, lines, excerpted, photoLines));
  const { title, body } = splitTitleBody(text);
  if (body.length === 0) return null;
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    title: title.length > 0 ? title : `${clock(session.startedAt)} の記録`,
    text: body,
  };
}

function dayPrompt(
  date: string,
  sessions: SessionSummary[],
  photos: Photo[],
  photoCount: number,
): string {
  const dateLabel = format(new Date(`${date}T00:00:00`), 'yyyy年M月d日 EEEE', { locale: ja });
  const parts = [`${dateLabel} の記録から、その日を振り返る日記を書いてください。`, ''];
  if (sessions.length > 0) {
    parts.push('会話の要約（時系列）:');
    for (const s of sessions) {
      parts.push(`- ${clock(s.startedAt)}〜${clock(s.endedAt)} ${s.title}: ${s.text}`);
    }
    parts.push('');
  }
  const photoLines = photos
    .filter((p) => p.description != null)
    .map((p) => `- ${clock(p.capturedAt)} ${p.description}`);
  if (photoLines.length > 0) {
    parts.push(`写真の説明（全 ${photoCount} 枚から抜粋）:`, ...photoLines, '');
  }
  parts.push(
    '出力は次の形式に従ってください:',
    '1 行目: その日を表す 20 字以内のタイトル',
    '2 行目以降: 300〜800 字の日記本文',
    '本文は 1 人称「私」の視点で、時系列に沿って自然な日記の文体（だ・である調）で書いてください。',
    '記録に無い出来事を創作しないでください。タイトルと本文だけを出力し、前置きは付けないでください。',
  );
  return parts.join('\n');
}

/** 同じ日付の生成を多重実行しないためのガード。 */
const inFlight = new Set<string>();

export function isGeneratingSummary(date: string): boolean {
  return inFlight.has(date);
}

/**
 * 指定日の DaySummary を生成して保存する。進捗は onProgress で通知する。
 * 入力（文字起こし・写真）がまだ無い日はエラーを投げる。
 */
export async function generateDaySummary(
  date: string,
  onProgress?: (progress: SummaryProgress) => void,
): Promise<DaySummary> {
  if (inFlight.has(date)) throw new Error('この日のサマリは生成中です');
  inFlight.add(date);
  try {
    const photos = getPhotosByIds(listPhotoIdsForDay(date)).sort(
      (a, b) => a.capturedAt - b.capturedAt,
    );
    const chunks = getAudioChunksByIds(listAudioIdsForDay(date)).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
    const sessions = getAudioSessionsByIds(listAudioSessionIdsForDay(date)).sort(
      (a, b) => a.startedAt - b.startedAt,
    );

    const hasTranscript = chunks.some((c) => (c.transcript?.text ?? '').length > 0);
    if (!hasTranscript && photos.length === 0) {
      throw new Error('この日の記録（文字起こし・写真）がまだありません');
    }

    onProgress?.({ phase: 'photos', current: 0, total: 1 });
    const described = await describePhotos(photos, (current, total) =>
      onProgress?.({ phase: 'photos', current, total }),
    );

    const charLimit = transcriptCharLimit();
    const sessionSummaries: SessionSummary[] = [];
    let sessionDone = 0;
    for (const session of sessions) {
      onProgress?.({ phase: 'sessions', current: sessionDone, total: sessions.length });
      const sessionChunks = chunks.filter((c) => c.sessionId === session.id);
      const summary = await summarizeSession(session, sessionChunks, described, charLimit);
      if (summary != null) sessionSummaries.push(summary);
      sessionDone += 1;
    }

    onProgress?.({ phase: 'day', current: 0, total: 1 });
    const { text, model } = await generateText(
      dayPrompt(date, sessionSummaries, described, photos.length),
    );
    const { title, body } = splitTitleBody(text);
    if (body.length === 0) throw new Error('日記の生成に失敗しました（本文が空です）');

    const result: DaySummary = {
      date,
      title: title.length > 0 ? title : '一日のまとめ',
      body,
      sessions: sessionSummaries,
      photoIds: described.map((p) => p.id),
      generatedAt: Date.now(),
      generatedBy: model,
      sourceChunkCount: chunks.length,
      sourcePhotoCount: photos.length,
    };
    saveDaySummary(result);
    return result;
  } finally {
    inFlight.delete(date);
  }
}
