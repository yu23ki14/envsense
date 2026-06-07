/**
 * 共通 LLM モジュールの公開 API。
 *
 * 用途（task）ごとに provider（cloud / local）とモデルを差し替えられる抽象。
 * 現状は文字起こし（transcription）のみ。画像 / テキストは将来ここへ集約する。
 */
export {
  DEFAULT_TRANSCRIPTION_REF,
  localModelIdOf,
  type ModelOption,
  TRANSCRIPTION_MODELS,
  transcriptionLabel,
} from './catalog';
export { getTranscriptionProvider, transcribe } from './registry';
export {
  type LlmTask,
  ModelUnavailableError,
  type ProviderKind,
  type TranscriptionProvider,
} from './types';
export { type UseWhisperModel, useWhisperModel, type WhisperModelStatus } from './useWhisperModel';
