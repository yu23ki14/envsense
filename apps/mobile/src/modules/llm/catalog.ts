import type { ModelRef } from '../../data';
import { GROQ_TEXT_REF } from './text/groq';
import { GROQ_WHISPER_REF } from './transcription/groq';
import type { LlmTask, ProviderKind } from './types';

/** 設定 UI と registry が参照する、用途ごとのモデル選択肢の単一の真実。 */
export type ModelOption = {
  /** settings に保存し registry が解決する安定 ref。 */
  ref: ModelRef;
  /** UI 表示名。 */
  label: string;
  kind: ProviderKind;
  task: LlmTask;
  /** local の場合のエンジン内モデル識別子（例: `gemma-4-e2b`）。 */
  modelId?: string;
  /** 補足（UI で注記表示）。 */
  note?: string;
};

const LOCAL_NOTE_E2B =
  'オンデバイス GPU (Gemma 4 E2B)・要モデルDL ~2.6GB（未DL/非対応時はクラウドにフォールバック）';
const LOCAL_NOTE_E4B =
  'オンデバイス GPU (Gemma 4 E4B)・E2Bより高精度・要モデルDL ~3.7GB / メモリ多め（未DL/非対応時はクラウドにフォールバック）';

export const TRANSCRIPTION_MODELS: ModelOption[] = [
  {
    ref: GROQ_WHISPER_REF,
    label: 'Groq Whisper (large-v3-turbo)',
    kind: 'cloud',
    task: 'transcription',
  },
  {
    ref: 'litert:gemma-4-e2b',
    label: 'ローカル (Gemma 4 E2B・GPU)',
    kind: 'local',
    task: 'transcription',
    modelId: 'gemma-4-e2b',
    note: LOCAL_NOTE_E2B,
  },
  {
    ref: 'litert:gemma-4-e4b',
    label: 'ローカル (Gemma 4 E4B・GPU・高精度)',
    kind: 'local',
    task: 'transcription',
    modelId: 'gemma-4-e4b',
    note: LOCAL_NOTE_E4B,
  },
];

/** クラウド既定。local 未対応/未DL 時のフォールバック先であり初期値でもある。 */
export const DEFAULT_TRANSCRIPTION_REF: ModelRef = GROQ_WHISPER_REF;

/**
 * サマリ（セッション要約・日記）生成のモデル選択肢。ローカルは文字起こしと同じ
 * Gemma 4（テキストモダリティ）を共有するので、片方を DL すれば両方で使える。
 * 写真の説明（vision）はクラウドのみ — ローカル Gemma は patches/ で
 * visionBackend を外しているため、ローカル選択時は文字起こし中心の要約になる。
 */
export const SUMMARY_MODELS: ModelOption[] = [
  {
    ref: GROQ_TEXT_REF,
    label: 'Groq Llama 4 Scout',
    kind: 'cloud',
    task: 'text',
    note: '写真の説明（画像解析）にも対応',
  },
  {
    ref: 'litert:gemma-4-e2b',
    label: 'ローカル (Gemma 4 E2B・GPU)',
    kind: 'local',
    task: 'text',
    modelId: 'gemma-4-e2b',
    note: 'オンデバイス生成・文字起こしとモデル共有（画像説明はクラウド補完時のみ）',
  },
  {
    ref: 'litert:gemma-4-e4b',
    label: 'ローカル (Gemma 4 E4B・GPU・高精度)',
    kind: 'local',
    task: 'text',
    modelId: 'gemma-4-e4b',
    note: 'オンデバイス生成・E2Bより高精度・メモリ多め（画像説明はクラウド補完時のみ）',
  },
];

/** クラウド既定。local 未対応/未DL 時のフォールバック先であり初期値でもある。 */
export const DEFAULT_SUMMARY_REF: ModelRef = GROQ_TEXT_REF;

/** ref から表示ラベルを引く。未知 ref はそのまま返す（旧データへの保険）。 */
export function transcriptionLabel(ref: string): string {
  return TRANSCRIPTION_MODELS.find((m) => m.ref === ref)?.label ?? ref;
}

/** ref から表示ラベルを引く（サマリ用）。未知 ref はそのまま返す。 */
export function summaryLabel(ref: string): string {
  return SUMMARY_MODELS.find((m) => m.ref === ref)?.label ?? ref;
}

/**
 * ローカル ref からエンジン内モデル識別子を引く。ローカルでなければ null。
 * `litert:*` の ref はタスク間で共通なので、全カタログを横断して探す。
 */
export function localModelIdOf(ref: string): string | null {
  const option = [...TRANSCRIPTION_MODELS, ...SUMMARY_MODELS].find((m) => m.ref === ref);
  return option?.kind === 'local' ? (option.modelId ?? null) : null;
}
