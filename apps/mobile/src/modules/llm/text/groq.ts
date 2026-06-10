import { type GroqChatMessage, groqChat } from '../groqChat';
import { hasGroqApiKey } from '../groqKey';
import type { TextProvider } from '../types';

// Llama 4 Scout はテキストと画像入力の両方に対応するので、text / vision で
// 同じモデルを使う（モデルロードの概念が無いクラウドでは分ける理由がない）。
export const GROQ_TEXT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/** catalog / settings に保存する安定 ref。 */
export const GROQ_TEXT_REF = 'groq:llama-4-scout';

/** クラウド（Groq Llama 4 Scout）の文章生成プロバイダ。 */
export const groqTextProvider: TextProvider = {
  model: GROQ_TEXT_REF,
  kind: 'cloud',
  isAvailable: () => hasGroqApiKey(),
  generate: async (prompt, opts) => {
    const messages: GroqChatMessage[] = [];
    if (opts?.system != null) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: prompt });
    return (await groqChat(GROQ_TEXT_MODEL, messages)).trim();
  },
};
