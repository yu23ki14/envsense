import { getGroqApiKey } from './groqKey';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** OpenAI 互換 chat/completions のメッセージ。vision はパート配列を使う。 */
export type GroqChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type GroqChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | GroqChatContentPart[];
};

type GroqChatResponse = {
  choices?: { message?: { content?: string } }[];
};

/** Groq chat/completions を叩いて応答本文を返す（text / vision 共通）。 */
export async function groqChat(model: string, messages: GroqChatMessage[]): Promise<string> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getGroqApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq chat failed: ${response.status} ${detail}`.trim());
  }
  const data = (await response.json()) as GroqChatResponse;
  return data.choices?.[0]?.message?.content ?? '';
}
