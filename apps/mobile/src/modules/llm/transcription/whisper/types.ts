/** ローカル STT エンジンの結果（speechText に渡せる segments 形）。 */
export type WhisperEngineResult = {
  text?: string;
  segments?: { text?: string }[];
};

/**
 * オンデバイス STT エンジンの抽象。実体は LiteRT-LM（`react-native-litert-lm`）+ Gemma 4 で、
 * Android(Pixel) は OpenCL GPU、iOS は Metal を使う。Gemma 4 の音声モダリティで「音声→テキスト」
 * を行う。native 実装を web バンドルへ持ち込まないため dispatcher（index.ts）越しに使う。
 *
 * `modelId` はカタログのローカルモデル識別子（例: `gemma-4-e2b`）。
 */
export interface WhisperEngine {
  /** ドキュメント相対パスの音声(Ogg)を文字起こしする。 */
  transcribeFile(
    relativePath: string,
    modelId: string,
    opts?: { language?: string },
  ): Promise<WhisperEngineResult>;
  /** テキストプロンプトから文章を生成する（要約など、Gemma のテキストモダリティ）。 */
  generateText(prompt: string, modelId: string): Promise<string>;
  /** モデルが端末にDL済みか（registry の cloud フォールバック判定に使う）。 */
  isModelReady(modelId: string): Promise<boolean>;
  /** モデルをDL（進捗 0..1）。完了で ready 扱いになる。 */
  downloadModel(modelId: string, onProgress?: (fraction: number) => void): Promise<void>;
}
