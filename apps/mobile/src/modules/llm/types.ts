import type { ModelRef } from '../../data';

/** Where inference runs: a remote API (cloud) or on the device (local). */
export type ProviderKind = 'cloud' | 'local';

/**
 * Inference用途。transcription（文字起こし）/ text（要約などの文章生成）/
 * vision（画像説明）。残る openai / ollama クライアントも将来ここへ移行する。
 */
export type LlmTask = 'transcription' | 'text' | 'vision';

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

/**
 * 文章生成（要約・日記）プロバイダの共通インターフェース。クラウド（Groq）と
 * ローカル（LiteRT / Gemma 4）が同じ口で差し替えられるようにする。
 */
export interface TextProvider {
  readonly model: ModelRef;
  readonly kind: ProviderKind;
  /** cloud: API キーの有無 / local: モデルが端末にあるか。 */
  isAvailable(): Promise<boolean>;
  /** prompt（必要なら system 付き）から本文テキストを生成する。 */
  generate(prompt: string, opts?: { system?: string }): Promise<string>;
}

/**
 * 画像説明（vision）プロバイダ。現状はクラウド（Groq）のみ —
 * react-native-litert-lm のパッチで visionBackend を外しているため
 * ローカル Gemma の画像入力は使えない（patches/ 参照）。
 */
export interface VisionProvider {
  readonly model: ModelRef;
  readonly kind: ProviderKind;
  isAvailable(): Promise<boolean>;
  /** ドキュメント相対パスの JPEG を説明する。 */
  describeImage(relativePath: string, prompt: string): Promise<string>;
}
