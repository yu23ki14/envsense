import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { keys } from '../keys';

const OPENAI_HEADERS = {
  Authorization: `Bearer ${keys.openai}`,
  'Content-Type': 'application/json',
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data URL prefix to get just the base64 string.
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: OPENAI_HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }
  return response.json();
}

export async function transcribeAudio(audioInput: string | File | Blob): Promise<unknown> {
  let audioBase64: string;
  if (Platform.OS === 'web') {
    if (typeof audioInput === 'string') {
      // A URL: fetch it first.
      const response = await fetch(audioInput);
      audioBase64 = await blobToBase64(await response.blob());
    } else {
      audioBase64 = await blobToBase64(audioInput);
    }
  } else {
    // Mobile: expect a file path string.
    audioBase64 = await FileSystem.readAsStringAsync(audioInput as string, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  try {
    return await postJson('https://api.openai.com/v1/audio/transcriptions', { audio: audioBase64 });
  } catch (error) {
    console.error('Error in transcribeAudio:', error);
    return null;
  }
}

let audioContext: AudioContext;

export async function startAudio(): Promise<void> {
  audioContext = new AudioContext();
}

export async function textToSpeech(text: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: OPENAI_HEADERS,
      body: JSON.stringify({ input: text, voice: 'nova', model: 'tts-1' }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }
    const data = await response.arrayBuffer();

    const audioBuffer = await audioContext.decodeAudioData(data);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();

    return data;
  } catch (error) {
    console.error('Error in textToSpeech:', error);
    return null;
  }
}

async function imageToBase64(imageInput: string | File | Blob): Promise<string> {
  if (Platform.OS === 'web') {
    let base64: string;
    if (typeof imageInput === 'string') {
      // A URL: fetch it first.
      const response = await fetch(imageInput);
      base64 = await blobToBase64(await response.blob());
    } else {
      base64 = await blobToBase64(imageInput);
    }
    const mimeType = (imageInput as File)?.type || 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
  }

  // Mobile: expect a file path string.
  const image = await FileSystem.readAsStringAsync(imageInput as string, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:image/jpeg;base64,${image}`;
}

export async function describeImage(imageInput: string | File | Blob): Promise<unknown> {
  const imageBase64 = await imageToBase64(imageInput);
  try {
    return await postJson('https://api.openai.com/v1/images/descriptions', { image: imageBase64 });
  } catch (error) {
    console.error('Error in describeImage:', error);
    return null;
  }
}

export async function gptRequest(systemPrompt: string, userPrompt: string): Promise<unknown> {
  try {
    return await postJson('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } catch (error) {
    console.error('Error in gptRequest:', error);
    return null;
  }
}
