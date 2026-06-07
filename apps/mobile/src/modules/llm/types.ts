import type { ModelRef } from '../../data';

/** Where inference runs: a remote API (cloud) or on the device (local). */
export type ProviderKind = 'cloud' | 'local';

/**
 * Inference用途。今は文字起こしのみ実装。画像キャプション / テキスト Q&A は
 * 既存の groq-llama3 / openai / ollama を将来この抽象へ移行する想定で型だけ予約する。
 */
export type LlmTask = 'transcription'; // 将来: | 'vision' | 'text'

/**
 * 選んだモデルが端末側に存在しない（ローカルモデル未ダウンロード等）ときに投げる。
 * registry の {@link transcribe} はこれを cloud フォールバックの判断に使わず、
 * `isAvailable()` で事前に弾く方針なので、これは provider 実装の最終防衛線。
 */
export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * 文字起こしプロバイダの共通インターフェース。クラウド（Groq）とローカル
 * （whisper.cpp）が同じ口で差し替えられるようにする。
 */
export interface TranscriptionProvider {
  /** チャンクに記録する実モデル ref（例 `groq:whisper-large-v3-turbo`）。 */
  readonly model: ModelRef;
  readonly kind: ProviderKind;
  /** cloud: API キーの有無 / local: モデルが端末にあるか。 */
  isAvailable(): Promise<boolean>;
  /**
   * ドキュメントディレクトリ相対パスの音声ファイルを文字起こしする。無音 /
   * 非発話セグメントは空文字を返す（呼び出し側はチャンクを保存しない）。
   */
  transcribe(relativePath: string, opts?: { language?: string }): Promise<string>;
}
