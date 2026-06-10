import { delay, exponentialBackoffDelay } from '../../utils/time';

/**
 * オンデバイス推論（LiteRT-LM）の共有直列キュー。文字起こしと文章生成は同じ
 * エンジン / モデルインスタンスを使うため、タスク種別をまたいで 1 件ずつ流す。
 * 並走させると OOM / 発熱や「Context is already transcribing」の原因になる。
 */
let queueTail: Promise<unknown> = Promise.resolve();

export function enqueueLocalInference<T>(job: () => Promise<T>): Promise<T> {
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
// ※ タイムアウトは engine.native 側で推論を打ち切る（JS だけで reject すると native の
//   推論が走り続け「Context is already transcribing」になるため）。
export async function withLocalRetry<T>(job: () => Promise<T>): Promise<T> {
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
