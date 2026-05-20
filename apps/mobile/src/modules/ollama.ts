import { keys } from '../keys';
import { toBase64 } from '../utils/base64';
import { backoff } from '../utils/time';
import { trimIdent } from '../utils/trimIdent';

export type KnownModel =
  | 'llama3'
  | 'llama3-gradient'
  | 'llama3:8b-instruct-fp16'
  | 'llava-llama3'
  | 'llava:34b-v1.6'
  | 'moondream:1.8b-v2-fp16'
  | 'moondream:1.8b-v2-moondream2-text-model-f16';

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: Uint8Array[];
};

type OllamaResponse = { message?: { content?: string } };

export async function ollamaInference(args: {
  model: KnownModel;
  messages: OllamaMessage[];
}): Promise<string> {
  const response = await backoff<OllamaResponse>(async () => {
    const converted = args.messages.map((message) => ({
      role: message.role,
      content: trimIdent(message.content),
      images: message.images ? message.images.map((image) => toBase64(image)) : undefined,
    }));

    const resp = await fetch(keys.ollama, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream: false,
        model: args.model,
        messages: converted,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Ollama request failed: ${resp.status}`);
    }
    return (await resp.json()) as OllamaResponse;
  });
  return trimIdent(response.message?.content ?? '');
}
