import { readBytes } from '../../../data';
import { toBase64Image } from '../../../utils/base64';
import { groqChat } from '../groqChat';
import { hasGroqApiKey } from '../groqKey';
import { GROQ_TEXT_MODEL } from '../text/groq';
import type { VisionProvider } from '../types';

/** catalog / Photo.descriptionModel に記録する安定 ref。 */
export const GROQ_VISION_REF = 'groq:llama-4-scout';

/**
 * クラウド（Groq Llama 4 Scout）の画像説明プロバイダ。vision は現状クラウドのみ
 * （ローカル Gemma は patches/ で visionBackend を外しているため画像入力不可）。
 */
export const groqVisionProvider: VisionProvider = {
  model: GROQ_VISION_REF,
  kind: 'cloud',
  isAvailable: () => hasGroqApiKey(),
  describeImage: async (relativePath, prompt) => {
    const bytes = await readBytes(relativePath);
    if (bytes == null) throw new Error(`Photo file not found: ${relativePath}`);
    const text = await groqChat(GROQ_TEXT_MODEL, [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: toBase64Image(bytes) } },
        ],
      },
    ]);
    return text.trim();
  },
};
