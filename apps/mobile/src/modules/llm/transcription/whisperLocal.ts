import { Platform } from 'react-native';
import { enqueueLocalInference, withLocalRetry } from '../localQueue';
import type { TranscriptionProvider } from '../types';
import { speechText } from './speech';
import { loadWhisperEngine } from './whisper';

/**
 * ローカル STT プロバイダ（オンデバイス推論、LiteRT-LM / Gemma 4）。
 *
 * `transcribe` は音声ファイルを LiteRT-LM（GPU/CPU）で文字起こしする（native の
 * {@link ./whisper}）。無音 / 非発話は既存の {@link speechText} で除去する。
 * `modelId` はエンジン内モデル識別子（例: `gemma-4-e2b`）。
 */
export function localWhisperProvider(ref: string, modelId: string): TranscriptionProvider {
  return {
    model: ref,
    kind: 'local',
    // モデルが端末にDL済みのときだけ利用可。未DLなら registry が（設定が許せば）クラウドへ。
    isAvailable: async () =>
      Platform.OS !== 'web' && (await (await loadWhisperEngine()).isModelReady(modelId)),
    transcribe: (relativePath, opts) =>
      enqueueLocalInference(() =>
        withLocalRetry(async () => {
          console.info(
            `[litert] transcribe start: ${relativePath} (model=${modelId}, lang=${opts?.language ?? 'auto'})`,
          );
          const engine = await loadWhisperEngine();
          const result = await engine.transcribeFile(relativePath, modelId, opts);
          const text = speechText(result);
          console.info(`[litert] transcribe done: kept ${text.length} chars`);
          return text;
        }),
      ),
  };
}
