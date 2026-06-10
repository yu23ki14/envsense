/**
 * 共通 LLM モジュールの公開 API。
 *
 * 用途（task）ごとに provider（cloud / local）とモデルを差し替えられる抽象。
 * transcription（文字起こし）/ text（サマリ生成）/ vision（画像説明）。
 */
export {
  DEFAULT_SUMMARY_REF,
  DEFAULT_TRANSCRIPTION_REF,
  localModelIdOf,
  type ModelOption,
  SUMMARY_MODELS,
  summaryLabel,
  TRANSCRIPTION_MODELS,
  transcriptionLabel,
} from './catalog';
export {
  generateText,
  getTextProvider,
  getTranscriptionProvider,
  getVisionProvider,
  transcribe,
} from './registry';
export {
  type LlmTask,
  ModelUnavailableError,
  type ProviderKind,
  type TextProvider,
  type TranscriptionProvider,
  type VisionProvider,
} from './types';
export { type UseWhisperModel, useWhisperModel, type WhisperModelStatus } from './useWhisperModel';
