import { File } from 'expo-file-system';
import { decodeAudioData } from 'react-native-audio-api';
import {
  checkBackendSupport,
  createLLM,
  GEMMA_4_E2B_IT,
  type LiteRTLMInstance,
} from 'react-native-litert-lm';
import { absoluteUri, deleteFile, writeBytes } from '../../../../data';
import { mmkv } from '../../../../data/storage/mmkv';
import { ModelUnavailableError } from '../../types';
import type { WhisperEngine, WhisperEngineResult } from './types';

const SAMPLE_RATE = 16000;

// ローカルは Gemma 4 E2B（音声マルチモーダル）。modelId → ダウンロード URL / 保存ファイル名。
// 注: GPU は Pixel 10(Tensor G5/PowerVR) では PowerVR ドライバ v25.1(Android16 QPR3)以降で
// OpenCL がフル機能になる。古いドライバだとプレフィルのテンソル確保に失敗する。
const MODEL: Record<string, { url: string; file: string }> = {
  'gemma-4-e2b': { url: GEMMA_4_E2B_IT, file: 'gemma-4-E2B-it.litertlm' },
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

// GPU(OpenCL) 推論が割り当て失敗する端末があるため、一度失敗したら CPU に切り替えて固定する。
let forceCpu = false;
// gpu(OpenCL) が使える端末（Pixel 等）は gpu、非対応端末（多くの Samsung/Qualcomm）は cpu。
function pickBackend(): 'gpu' | 'cpu' {
  if (forceCpu) return 'cpu';
  return checkBackendSupport('gpu') == null ? 'gpu' : 'cpu';
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
  console.info(`[litert] loadModel backend=${backend}`);
  await m.loadModel(path, { backend, multimodal: true });
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
  // Gemma の音声入力はファイルパス(WAV)なので一時 WAV を書き出して渡す。
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
    const text = await m.sendMessageWithAudio(transcriptionPrompt(opts?.language), wavPath);
    console.info(
      `[litert] transcribe done (${loadedBackend}, ${Date.now() - started}ms): "${(text ?? '').slice(0, 60)}"`,
    );
    return text;
  };

  try {
    try {
      return { text: await runOnce() };
    } catch (err) {
      // GPU(OpenCL/PowerVR ドライバ等)でテンソル確保に失敗する端末があるため、初回失敗時は
      // CPU に切り替えて作り直して 1 度だけ再試行する（以後は CPU 固定）。
      if (!forceCpu && loadedBackend === 'gpu') {
        console.warn(`[litert] GPU inference failed, falling back to CPU: ${String(err)}`);
        forceCpu = true;
        loadedModel = null;
        loadedBackend = null;
        return { text: await runOnce() };
      }
      throw err;
    }
  } finally {
    deleteFile(wavRel);
  }
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

export const whisperEngine: WhisperEngine = { transcribeFile, isModelReady, downloadModel };
