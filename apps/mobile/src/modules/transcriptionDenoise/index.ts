// Transcription-input denoising stage.
//
// Decodes a staged Ogg/Opus segment to PCM, runs the gentle denoiser, and writes
// a transient WAV that is transcribed in place of the original. This improves the
// audio fed to STT (cloud Groq + local Gemma) WITHOUT touching the durable
// session/playback Opus file.
//
// Native only: the decoder (`react-native-audio-api`) is a native module, so it
// must stay out of the web bundle — hence the BLE/engine-style platform-split
// dynamic import. On web (or on any failure) we return null and the caller
// transcribes the original Ogg unchanged.
import { Platform } from 'react-native';

/**
 * Returns a relative path to a denoised WAV to transcribe instead of
 * `oggRelativePath`, or null to transcribe the original unchanged. The caller
 * owns deleting the returned file after transcription.
 */
export async function denoisedWavFor(oggRelativePath: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const { decodeDenoiseToWav } = await import('./engine.native');
    return await decodeDenoiseToWav(oggRelativePath);
  } catch (err) {
    console.warn('denoise stage failed; transcribing original audio', err);
    return null;
  }
}
