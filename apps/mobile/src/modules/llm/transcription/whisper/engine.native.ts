import { File } from 'expo-file-system';
import { decodeAudioData } from 'react-native-audio-api';
import {
  createLLM,
  GEMMA_4_E2B_IT,
  GEMMA_4_E4B_IT,
  type LiteRTLMInstance,
} from 'react-native-litert-lm';
import { absoluteUri, deleteFile, writeBytes } from '../../../../data';
import { mmkv } from '../../../../data/storage/mmkv';
import { ModelUnavailableError } from '../../types';
import type { WhisperEngine, WhisperEngineResult } from './types';

const SAMPLE_RATE = 16000;

// 音声プレフィルが確保するトークン予算。LiteRT-LM の maxNumTokens は「入力(=音声トークン)
// ＋出力」の総枠で、ラッパー既定の 1024 では Gemma 4 E2B の音声プレフィルで
// `Failed to allocate tensors`(RunPrefillAsync) になる。動作実績のある公式/コミュニティ例
// (Edge Gallery 系)は 4096 を使うため、それに合わせる。
const MAX_TOKENS = 4096;

// GPU(OpenCL) は loadModel が通っても音声推論で固まる端末がある（PowerVR/Mali 等。onDone/onError
// が来ず Promise が解決しない）。エラーを投げないので時間で打ち切り CPU にフォールバックする。
// GPU が動く場合 prefill は数秒で終わる（公式報告で ~426 tok/s）。動かない端末は無言ハングする
// ので、それを十分に超える 60s で打ち切って CPU にフォールバックする。
const GPU_INFERENCE_TIMEOUT_MS = 60000;

class InferenceTimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new InferenceTimeoutError(`${label} timed out (${ms}ms)`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ローカルは Gemma 4 E2B（音声マルチモーダル）。modelId → ダウンロード URL / 保存ファイル名。
// 注: GPU は Pixel 10(Tensor G5/PowerVR) では PowerVR ドライバ v25.1(Android16 QPR3)以降で
// OpenCL がフル機能になる。古いドライバだとプレフィルのテンソル確保に失敗する。
const MODEL: Record<string, { url: string; file: string }> = {
  'gemma-4-e2b': { url: GEMMA_4_E2B_IT, file: 'gemma-4-E2B-it.litertlm' },
  // E4B は E2B より高精度だがメモリ・DL が大きい（~3.65GB）。Pixel 10 は RAM 十分。
  'gemma-4-e4b': { url: GEMMA_4_E4B_IT, file: 'gemma-4-E4B-it.litertlm' },
};

// DL 済みモデルの絶対パスを MMKV に記録する。LiteRT-LM に公開の存在判定が無いため、
// 「パスが記録済み」かつ「実ファイルが存在」で readiness を判定する。フラグだけだと
// キャッシュ削除等でフラグだけ残り、転写中に勝手に再DL（数GB）/失敗する desync が起きる。
const pathKey = (modelId: string) => `litert:model-path:${modelId}`;

function fileExists(path: string): boolean {
  try {
    return new File(path.startsWith('file://') ? path : `file://${path}`).exists;
  } catch {
    return false;
  }
}

let llm: LiteRTLMInstance | null = null;
function getLlm(): LiteRTLMInstance {
  if (llm == null) llm = createLLM();
  return llm;
}

// GPU(OpenCL/Metal) 推論が失敗する端末があるため、一度失敗したら CPU に切り替えて固定する。
let forceCpu = false;
// まず GPU を試す（iOS=Metal, Android=OpenCL）。checkBackendSupport('gpu') は Android では端末を
// 問わず常に注意文を返す静的判定で、実機の OpenCL を見ない（Pixel でも cpu になってしまう）ため
// 使わない。実際の可否はネイティブ loadModel の OpenCL プローブに委ね、失敗時は CPU に落とす。
function pickBackend(): 'gpu' | 'cpu' {
  return forceCpu ? 'cpu' : 'gpu';
}

let loadedModel: string | null = null;
let loadedBackend: 'gpu' | 'cpu' | null = null;
async function ensureLoaded(modelId: string): Promise<LiteRTLMInstance> {
  const m = getLlm();
  const backend = pickBackend();
  if (loadedModel === modelId && loadedBackend === backend && m.isReady()) return m;
  const path = mmkv.getString(pathKey(modelId));
  if (path == null || !fileExists(path)) {
    // 未DL（または実体が消えた）。registry のフォールバック判断に委ねるため明示的に失敗。
    throw new ModelUnavailableError(`ローカルモデル未準備: ${modelId}`);
  }
  // DL 済みファイルのパスからロード（URL を渡さないので転写中に勝手に再DLされない）。
  // maxTokens を明示しないとラッパー既定(1024)になり、音声プレフィルでテンソル確保に失敗する。
  // 文字起こしは決定論的タスクなので greedy デコードにする。ラッパー既定(temperature=0.7,
  // topK=40)だと“創造的に”サンプリングして語句が崩れる（「アートモデル」等の幻覚・余分な空白）。
  // topK=1 で常に最尤トークンを選ばせ（= greedy）、temperature は 0 に倒して揺らぎを消す。
  console.info(`[litert] loadModel backend=${backend}`);
  await m.loadModel(path, {
    backend,
    multimodal: true,
    maxTokens: MAX_TOKENS,
    temperature: 0,
    topK: 1,
    topP: 1,
  });
  loadedModel = modelId;
  loadedBackend = backend;
  return m;
}

/** Float32[-1,1] → 16bit mono WAV のバイト列。 */
function floatToWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}

function transcriptionPrompt(language?: string): string {
  const lang = language === 'ja' ? '音声は日本語です。' : '';
  return `次の音声を逐語で文字起こししてください。${lang}文字起こしのテキストだけを出力し、説明や前置きは付けないでください。`;
}

async function transcribeFile(
  relativePath: string,
  modelId: string,
  opts?: { language?: string },
): Promise<WhisperEngineResult> {
  // Ogg/Opus → 16kHz mono PCM（iOS が Ogg を復号できないので audio-api の自前デコーダ）→ WAV。
  // 音声は WAV ファイルパス(Content.AudioFile)で渡す。生 PCM を ArrayBuffer で渡す
  // sendMultimodalMessage は、ラッパーが Promise.parallel(別スレッド)内で JS 所有 ArrayBuffer を
  // 触るため `size() can only be accessed synchronously on the JS Thread` で落ちる。
  console.info(`[litert] decode start: ${relativePath}`);
  const audio = await decodeAudioData(absoluteUri(relativePath), SAMPLE_RATE);
  const wavRel = relativePath.replace(/\.ogg$/, '.wav');
  writeBytes(wavRel, floatToWav(audio.getChannelData(0), audio.sampleRate));
  const wavPath = absoluteUri(wavRel).replace('file://', '');

  const runOnce = async (): Promise<string> => {
    const m = await ensureLoaded(modelId);
    m.resetConversation(); // セグメントごとに独立（履歴を持ち越さない）
    console.info(`[litert] transcribe start (backend=${loadedBackend})`);
    const started = Date.now();
    const infer = m.sendMessageWithAudio(transcriptionPrompt(opts?.language), wavPath);
    // GPU はハングしうるので時間で打ち切る。CPU は信頼できるので待ち切る。
    const text =
      loadedBackend === 'gpu'
        ? await withTimeout(infer, GPU_INFERENCE_TIMEOUT_MS, 'gpu transcribe')
        : await infer;
    console.info(
      `[litert] transcribe done (${loadedBackend}, ${Date.now() - started}ms): "${(text ?? '').slice(0, 60)}"`,
    );
    return text;
  };

  try {
    return { text: await withCpuFallback(runOnce) };
  } finally {
    deleteFile(wavRel);
  }
}

/**
 * GPU(OpenCL 未対応 / PowerVR ドライバ等)では loadModel の OpenCL プローブや推論で失敗する。
 * forceCpu でない＝まだ GPU を試している段階なので、初回失敗時は CPU に切り替えて 1 度だけ
 * 再試行する（loadModel 段階の失敗でも loadedBackend に依存せず確実に CPU へ落とす）。
 */
async function withCpuFallback(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (err) {
    if (!forceCpu) {
      console.warn(`[litert] GPU path failed, falling back to CPU: ${String(err)}`);
      forceCpu = true;
      loadedModel = null;
      loadedBackend = null;
      // ハング時は GPU engine が裏で生きたまま。同じインスタンスで loadModel(cpu) すると
      // cleanupInternal が稼働中の engine を close して native がクラッシュしうるので、
      // インスタンスごと破棄して CPU 用に作り直す（ハングした GPU engine は孤立させる）。
      if (err instanceof InferenceTimeoutError) llm = null;
      return run();
    }
    throw err;
  }
}

/**
 * テキストプロンプトから文章を生成する（サマリ生成用、Gemma のテキストモダリティ）。
 * 文字起こしと同じロード済みモデル / greedy デコード設定を共有する。要約も事実の
 * 列挙に近い決定論的タスクなので greedy で十分で、設定を分けるとタスク切替のたびに
 * 数 GB のモデルを再ロードすることになる。
 */
async function generateText(prompt: string, modelId: string): Promise<string> {
  const runOnce = async (): Promise<string> => {
    const m = await ensureLoaded(modelId);
    m.resetConversation(); // 呼び出しごとに独立（履歴を持ち越さない）
    console.info(`[litert] generate start (backend=${loadedBackend})`);
    const started = Date.now();
    const infer = m.sendMessage(prompt);
    // GPU はハングしうるので時間で打ち切る。CPU は信頼できるので待ち切る。
    const text =
      loadedBackend === 'gpu'
        ? await withTimeout(infer, GPU_INFERENCE_TIMEOUT_MS, 'gpu generate')
        : await infer;
    console.info(
      `[litert] generate done (${loadedBackend}, ${Date.now() - started}ms): ${(text ?? '').length} chars`,
    );
    return text;
  };
  return withCpuFallback(runOnce);
}

async function isModelReady(modelId: string): Promise<boolean> {
  const path = mmkv.getString(pathKey(modelId));
  return path != null && fileExists(path);
}

async function downloadModel(
  modelId: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const spec = MODEL[modelId];
  if (spec == null) throw new Error(`Unknown local model: ${modelId}`);
  // DL のみ（メモリへのロードは初回 transcribe 時に遅延実行）。返る絶対パスを記録する。
  const path = await getLlm().downloadModel(spec.url, spec.file, (p) => onProgress?.(p));
  mmkv.set(pathKey(modelId), path);
}

export const whisperEngine: WhisperEngine = {
  transcribeFile,
  generateText,
  isModelReady,
  downloadModel,
};
