import { getSettings, type ModelRef } from '../../data';
import { DEFAULT_TRANSCRIPTION_REF, localModelIdOf } from './catalog';
import { groqWhisperProvider } from './transcription/groq';
import { localWhisperProvider } from './transcription/whisperLocal';
import type { TranscriptionProvider } from './types';

/**
 * ref から文字起こしプロバイダを解決する。`litert:*` はローカル（オンデバイス）、それ以外
 * （`groq:*` および未知 ref）はクラウド（Groq）。
 */
export function getTranscriptionProvider(ref: string): TranscriptionProvider {
  const modelId = localModelIdOf(ref);
  if (modelId != null) return localWhisperProvider(ref, modelId);
  return groqWhisperProvider;
}

function resolveLanguage(opts?: { language?: string }): string | undefined {
  const configured = getSettings().audio.transcriptionLanguage;
  // 設定の言語ヒントを既定にし、呼び出し側が明示した場合のみ上書き。'auto'/空は undefined
  // （whisper は自動判定、Groq は language 未指定）。
  return (
    opts?.language ??
    (configured == null || configured === 'auto' || configured === '' ? undefined : configured)
  );
}

/**
 * 設定（`audio.transcriptionModel`）に従って音声を文字起こしする。
 *
 * ローカルを選んでいて「未準備」または「推論失敗」のとき、`audio.cloudFallback` が有効なら
 * クラウド既定（Groq）で補完する。無効ならフォールバックせずエラーを投げる（＝ユーザーが
 * 「ローカルのみ／クラウドに出さない」を選べる）。戻り値の `model` は **実際に使った** ref。
 */
export async function transcribe(
  relativePath: string,
  opts?: { language?: string },
): Promise<{ text: string; model: ModelRef }> {
  const settings = getSettings();
  const ref = settings.audio.transcriptionModel;
  const cloudFallback = settings.audio.cloudFallback;
  const language = resolveLanguage(opts);

  const provider = getTranscriptionProvider(ref);

  const runCloud = async () => {
    const cloud = getTranscriptionProvider(DEFAULT_TRANSCRIPTION_REF);
    const text = await cloud.transcribe(relativePath, { language });
    return { text, model: cloud.model };
  };

  // 未準備（ローカル未DL/非対応）の場合。
  if (!(await provider.isAvailable())) {
    if (provider.kind === 'cloud') {
      // クラウド自体が未準備（APIキー無し等）でも、実行させてエラーを表面化させる。
      const text = await provider.transcribe(relativePath, { language });
      return { text, model: provider.model };
    }
    if (!cloudFallback) {
      throw new Error(`ローカルモデル未準備で、クラウドフォールバックは無効です: ${ref}`);
    }
    console.info(`Transcription provider "${ref}" unavailable; falling back to cloud`);
    return runCloud();
  }

  // 利用可能。推論を実行し、ローカルの実行時失敗時のみ（設定が許せば）クラウドへ。
  try {
    const text = await provider.transcribe(relativePath, { language });
    return { text, model: provider.model };
  } catch (err) {
    if (provider.kind !== 'cloud' && cloudFallback) {
      console.warn(`Local transcription failed; falling back to cloud: ${String(err)}`);
      return runCloud();
    }
    throw err;
  }
}
