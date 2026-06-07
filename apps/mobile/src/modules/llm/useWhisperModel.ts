import { useCallback, useEffect, useRef, useState } from 'react';
import { loadWhisperEngine } from './transcription/whisper';

export type WhisperModelStatus = 'unknown' | 'absent' | 'downloading' | 'ready';

export type UseWhisperModel = {
  status: WhisperModelStatus;
  /** ダウンロード進捗 0..1。 */
  progress: number;
  error: string | null;
  download: () => Promise<void>;
};

/**
 * ローカル（LiteRT / Gemma 4）モデルの DL 状態を管理する画面用フック。マウント時に存在判定し、
 * `download()` で進捗付きダウンロードする。`modelId` はエンジン内モデル識別子。
 */
export function useWhisperModel(modelId: string): UseWhisperModel {
  const [status, setStatus] = useState<WhisperModelStatus>('unknown');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // アンマウント後（または DL 中に別モデルへ切替）に setState しないためのガード。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('unknown');
    loadWhisperEngine()
      .then((engine) => engine.isModelReady(modelId))
      .then((ok) => {
        if (!cancelled) setStatus(ok ? 'ready' : 'absent');
      })
      .catch(() => {
        if (!cancelled) setStatus('absent');
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const download = useCallback(async () => {
    setError(null);
    setProgress(0);
    setStatus('downloading');
    try {
      const engine = await loadWhisperEngine();
      await engine.downloadModel(modelId, (p) => {
        if (mounted.current) setProgress(p);
      });
      if (mounted.current) setStatus('ready');
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('absent');
      }
    }
  }, [modelId]);

  return { status, progress, error, download };
}
