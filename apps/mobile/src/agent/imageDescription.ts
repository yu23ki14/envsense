import { groqRequest, groqVisionRequest } from '../modules/groq-llama3';
import { gptRequest } from '../modules/openai';

function findSystemPrompt(images: string): string {
  return `
You are a smart AI that need to read through description of a images and answer user's questions.

This are the provided images:
${images}

DO NOT mention the images, scenes or descriptions in your answer, just answer the question.
DO NOT try to generalize or provide possible scenarios.
ONLY use the information in the description of the images to answer the question.
BE concise and specific.
`;
}

export async function imageDescription(src: Uint8Array): Promise<string> {
  return groqVisionRequest(
    'Describe the scene as precisely as possible. Transcribe any text you see.',
    src,
  );
}

export async function llamaFind(question: string, images: string): Promise<string> {
  return (await groqRequest(findSystemPrompt(images), question)) ?? '';
}

export async function openAIFind(question: string, images: string): Promise<string> {
  const response = await gptRequest(findSystemPrompt(images), question);
  const content = (response as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
    ?.message?.content;
  return content ?? '';
}
