import { keys } from '../keys';
import { toBase64Image } from '../utils/base64';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

type GroqChatResponse = {
  choices?: { message?: { content?: string } }[];
};

async function groqChat(body: unknown): Promise<GroqChatResponse> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${keys.groq}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Groq request failed: ${response.status}`);
  }
  return (await response.json()) as GroqChatResponse;
}

export async function groqRequest(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  try {
    console.info('Calling Groq llama3-70b-8192');
    const data = await groqChat({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error('Error in groqRequest:', error);
    return null;
  }
}

export async function groqVisionRequest(prompt: string, image: Uint8Array): Promise<string> {
  const dataUrl = toBase64Image(image);
  const data = await groqChat({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return data.choices?.[0]?.message?.content ?? '';
}
