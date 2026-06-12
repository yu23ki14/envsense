import { z } from 'zod';
import { ModelRef } from './common';

// 撮影間隔はファームウェア固定（modules/useDeviceCapture の CAPTURE_INTERVAL_SEC を参照）の
// ため設定には持たない。旧データの intervalSec キーは zod が parse 時に黙って捨てる。
export const CaptureSettings = z.object({
  resolution: z.enum(['VGA', 'SVGA']),
  privateMode: z.boolean(),
  // キャプチャモード（ユーザーの意図）。'local' は SD カードへ記録して後で同期、
  // 'streaming' は接続中 BLE で即時転送（圏外中は SD へフォールバック）。接続のたびに
  // デバイスへ書き込む（modules/useDeviceMode）。`.default` で旧データもマイグレーション不要。
  captureMode: z.enum(['local', 'streaming']).default('local'),
});
export type CaptureSettings = z.infer<typeof CaptureSettings>;

export const AudioSettings = z.object({
  autoRecord: z.boolean(),
  transcriptionModel: ModelRef,
  // 文字起こしの言語ヒント。'auto' は whisper の自動判定。base モデルは短い音声の
  // 自動判定が弱く日本語を崩しやすいので、既定は 'ja'。`.default` で旧データ
  // （このキーが無い保存済み設定）もマイグレーションなしで読める。
  transcriptionLanguage: z.string().default('ja'),
  // ローカル文字起こしが未準備/失敗したときにクラウド(Groq)で補完するか。false なら
  // 音声を端末外に出さない（＝ローカルのみ）。`.default` で旧データもマイグレーション不要。
  cloudFallback: z.boolean().default(true),
});
export type AudioSettings = z.infer<typeof AudioSettings>;

/** AI サマリ（セッション要約・日記）生成の設定。 */
export const SummarySettings = z.object({
  /** 文章生成モデル（modules/llm の SUMMARY_MODELS の ref）。 */
  model: ModelRef,
  // ローカル生成が未準備/失敗したときにクラウド(Groq)で補完するか。false なら
  // 文字起こしテキストも写真も端末外に出さない（＝写真の説明生成もスキップされる）。
  cloudFallback: z.boolean().default(true),
});
export type SummarySettings = z.infer<typeof SummarySettings>;

export const SyncSettings = z.object({
  autoSyncMode: z.enum(['wifi', 'always', 'manual']),
  preferredSsid: z.string().nullable(),
});
export type SyncSettings = z.infer<typeof SyncSettings>;

export const ExportFormat = z.enum(['zip', 'json', 'markdown']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportIncludes = z.object({
  photos: z.boolean(),
  audio: z.boolean(),
  transcripts: z.boolean(),
  summary: z.boolean(),
});
export type ExportIncludes = z.infer<typeof ExportIncludes>;

export const ExportDefaults = z.object({
  format: ExportFormat,
  includes: ExportIncludes,
});
export type ExportDefaults = z.infer<typeof ExportDefaults>;

export const Settings = z.object({
  schemaVersion: z.number().int().nonnegative(),
  capture: CaptureSettings,
  audio: AudioSettings,
  // `.default` で旧データ（このキーが無い保存済み設定）もマイグレーションなしで読める。
  summary: SummarySettings.default({
    model: 'groq:llama-4-scout',
    cloudFallback: true,
  }),
  sync: SyncSettings,
  export: ExportDefaults,
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  capture: {
    resolution: 'VGA',
    privateMode: false,
    captureMode: 'local',
  },
  audio: {
    autoRecord: true,
    // クラウド既定。ローカル whisper は #62 で実装するまで未対応なので、
    // 足場段階では初期状態から動く Groq を既定にする。
    transcriptionModel: 'groq:whisper-large-v3-turbo',
    transcriptionLanguage: 'ja',
    cloudFallback: true,
  },
  summary: {
    // クラウド既定（初期状態から動く）。文字列は modules/llm の GROQ_TEXT_REF と
    // 一致させる（data → modules の import は循環になるためリテラルで持つ）。
    model: 'groq:llama-4-scout',
    cloudFallback: true,
  },
  sync: {
    autoSyncMode: 'wifi',
    preferredSsid: null,
  },
  export: {
    format: 'zip',
    includes: {
      photos: true,
      audio: true,
      transcripts: true,
      summary: false,
    },
  },
};
