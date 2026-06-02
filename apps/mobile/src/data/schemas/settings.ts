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
    transcriptionModel: 'whisper.cpp:base',
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
