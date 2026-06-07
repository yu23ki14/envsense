import { ModelUnavailableError } from '../../types';
import type { WhisperEngine } from './types';

/** web ではローカル STT 非対応（Cactus はネイティブモジュール）。 */
export const whisperEngine: WhisperEngine = {
  transcribeFile: async () => {
    throw new ModelUnavailableError('ローカル文字起こしは web では利用できません');
  },
  isModelReady: async () => false,
  downloadModel: async () => {
    throw new ModelUnavailableError('ローカルモデルのダウンロードは web では利用できません');
  },
};
