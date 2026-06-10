import { Platform } from 'react-native';
import { enqueueLocalInference, withLocalRetry } from '../localQueue';
import { loadWhisperEngine } from '../transcription/whisper';
import type { TextProvider } from '../types';

/**
 * ローカル文章生成プロバイダ（オンデバイス推論、LiteRT-LM / Gemma 4）。
 *
 * 文字起こしと同じエンジン / ダウンロード済みモデルを共有するので、ローカル文字起こしを
 * 使っていれば追加 DL なしで動く。LiteRT の systemPrompt はモデルロード時にしか渡せない
 * ため、system はユーザープロンプトの先頭に畳み込む。
 */
export function gemmaLocalTextProvider(ref: string, modelId: string): TextProvider {
  return {
    model: ref,
    kind: 'local',
    // モデルが端末にDL済みのときだけ利用可。未DLなら registry が（設定が許せば）クラウドへ。
    isAvailable: async () =>
      Platform.OS !== 'web' && (await (await loadWhisperEngine()).isModelReady(modelId)),
    generate: (prompt, opts) =>
      enqueueLocalInference(() =>
        withLocalRetry(async () => {
          const merged = opts?.system != null ? `${opts.system}\n\n${prompt}` : prompt;
          console.info(`[litert] text generate start (model=${modelId})`);
          const engine = await loadWhisperEngine();
          const text = await engine.generateText(merged, modelId);
          return text.trim();
        }),
      ),
  };
}
