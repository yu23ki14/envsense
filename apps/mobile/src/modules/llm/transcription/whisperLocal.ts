import { Platform } from 'react-native';
import { delay, exponentialBackoffDelay } from '../../../utils/time';
import type { TranscriptionProvider } from '../types';
import { speechText } from './speech';
import { loadWhisperEngine } from './whisper';

// オンデバイス推論は重いので 1 件ずつ直列に流す。capture は ~10 秒ごとに
// セグメントを投げてくるが、同時に whisper を走らせると OOM / 発熱の原因になる。
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queueTail.then(job, job);
  // キューは失敗で止めない（次のジョブへ進む）。
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const MAX_ATTEMPTS = 3;

// 失敗時は最大 MAX_ATTEMPTS 回まで（コンテキスト初期化中などの一過性を吸収）。
// createBackoff は無限リトライなので、ここでは試行回数を区切った独自リトライにする。
// ※ タイムアウトは engine.native 側で whisper の stop() を呼んで打ち切る（JS だけで
//   reject すると native の推論が走り続け「Context is already transcribing」になるため）。
async function withRetry<T>(job: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await job();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await delay(exponentialBackoffDelay(attempt, 300, 1500, MAX_ATTEMPTS));
      }
    }
  }
  throw lastError;
}

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
      enqueue(() =>
        withRetry(async () => {
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
