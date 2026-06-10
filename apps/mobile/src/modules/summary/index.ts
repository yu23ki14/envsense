/**
 * AI サマリ（セッション要約・日記）生成モジュールの公開 API。
 * モデル選択とフォールバックは modules/llm（Settings.summary）に従う。
 */
export {
  generateDaySummary,
  isGeneratingSummary,
  type SummaryPhase,
  type SummaryProgress,
} from './generateDaySummary';
export { type UseSummaryGenerator, useSummaryGenerator } from './useSummaryGenerator';
