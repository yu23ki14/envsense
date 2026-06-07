import { z } from 'zod';
import { ModelRef } from './common';

export const CaptureSettings = z.object({
  intervalSec: z.number().int().positive(),
  resolution: z.enum(['VGA', 'SVGA']),
  privateMode: z.boolean(),
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
  sync: SyncSettings,
  export: ExportDefaults,
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  capture: {
    intervalSec: 5,
    resolution: 'VGA',
    privateMode: false,
  },
  audio: {
    autoRecord: true,
    // クラウド既定。ローカル whisper は #62 で実装するまで未対応なので、
    // 足場段階では初期状態から動く Groq を既定にする。
    transcriptionModel: 'groq:whisper-large-v3-turbo',
    transcriptionLanguage: 'ja',
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
