import { decodeAudioData } from 'react-native-audio-api';
import { absoluteUri, writeBytes } from '../../data';
import { floatToWav } from '../audioPcm';
import { denoisePcm } from '../denoise';

// STT target rate. decodeAudioData resamples to this and we keep mono ch 0.
const SAMPLE_RATE = 16000;

/**
 * Decode `oggRelativePath` → 16 kHz mono PCM, denoise, and write a sibling
 * `.denoised.wav`. Returns its relative path. Throws on decode failure (the
 * caller falls back to the original Ogg).
 */
export async function decodeDenoiseToWav(oggRelativePath: string): Promise<string> {
  const audio = await decodeAudioData(absoluteUri(oggRelativePath), SAMPLE_RATE);
  const cleaned = denoisePcm(audio.getChannelData(0), { sampleRate: audio.sampleRate });
  const wavRelative = `${oggRelativePath.replace(/\.ogg$/, '')}.denoised.wav`;
  writeBytes(wavRelative, floatToWav(cleaned, audio.sampleRate));
  return wavRelative;
}
