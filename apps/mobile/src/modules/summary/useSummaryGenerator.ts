import { useCallback, useEffect, useRef, useState } from 'react';
import {
  generateDaySummary,
  isGeneratingSummary,
  type SummaryProgress,
} from './generateDaySummary';

export type UseSummaryGenerator = {
  generating: boolean;
  /** 生成中の進捗。フェーズと件数は UI 側でラベルに変換する。 */
  progress: SummaryProgress | null;
  error: string | null;
  generate: () => Promise<void>;
};

/**
 * 画面用のサマリ生成フック。生成結果は MMKV に保存され `useDaySummary(date)` が
 * 反応的に拾うので、ここでは実行状態（進捗・エラー）だけを持つ。
 */
export function useSummaryGenerator(date: string): UseSummaryGenerator {
  // 既に裏で同じ日付が生成中の場合（画面を開き直した等）も「生成中」を表示する。
  const [generating, setGenerating] = useState(() => isGeneratingSummary(date));
  const [progress, setProgress] = useState<SummaryProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // アンマウント後に setState しないためのガード。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const generate = useCallback(async () => {
    if (isGeneratingSummary(date)) return;
    setError(null);
    setProgress(null);
    setGenerating(true);
    try {
      await generateDaySummary(date, (p) => {
        if (mounted.current) setProgress(p);
      });
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) {
        setGenerating(false);
        setProgress(null);
      }
    }
  }, [date]);

  return { generating, progress, error, generate };
}
