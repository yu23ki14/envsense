import type { ModelRef } from '../../data';
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

/** ref から表示ラベルを引く。未知 ref はそのまま返す（旧データへの保険）。 */
export function transcriptionLabel(ref: string): string {
  return TRANSCRIPTION_MODELS.find((m) => m.ref === ref)?.label ?? ref;
}

/** ローカル ref から Cactus モデル slug を引く。ローカルでなければ null。 */
export function localModelIdOf(ref: string): string | null {
  const option = TRANSCRIPTION_MODELS.find((m) => m.ref === ref);
  return option?.kind === 'local' ? (option.modelId ?? null) : null;
}
