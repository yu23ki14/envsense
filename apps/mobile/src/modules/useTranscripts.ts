import * as React from 'react';
import { opusFramesToOgg } from './audio';
import type { BleDevice } from './ble';
import { transcribeAudioWithGroq } from './whisper';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const AUDIO_DATA_UUID = 'ea800001-9c72-497f-81f9-752ffe11f565';
const AUDIO_CODEC_UUID = 'ea800002-9c72-497f-81f9-752ffe11f565';

// Opus frames @ 20 ms each -> 500 frames is ~10 seconds of audio per request.
const FRAMES_PER_SEGMENT = 500;
// Codec id advertised by the firmware's AUDIO_CODEC characteristic.
const AUDIO_CODEC_ID_OPUS = 21;
// Audio packets carry a 3-byte header (2-byte index + 1-byte sub-index).
const AUDIO_PACKET_HEADER_SIZE = 3;

export type Transcript = { text: string; timestamp: number };

/**
 * Subscribe to the device's Opus audio stream and transcribe it in ~10 s
 * segments via Groq Whisper. Works on web and native: the audio is wrapped
 * into Ogg/Opus ({@link opusFramesToOgg}) and sent to Groq as-is, so there is
 * no WebAssembly Opus decoder and no platform guard.
 */
export function useTranscripts(device: BleDevice): Transcript[] {
  const [transcripts, setTranscripts] = React.useState<Transcript[]>([]);

  React.useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    let pendingFrames: Uint8Array[] = [];
    let transcribing = false;

    const flush = async () => {
      if (transcribing || pendingFrames.length < FRAMES_PER_SEGMENT) {
        return;
      }
      transcribing = true;
      const batch = pendingFrames;
      pendingFrames = [];
      try {
        const ogg = opusFramesToOgg(batch);
        const text = await transcribeAudioWithGroq(ogg, 'audio.ogg');
        if (!cancelled && text) {
          setTranscripts((prev) => [...prev, { text, timestamp: Date.now() }]);
        }
      } catch (err) {
        console.error('Transcription failed', err);
      } finally {
        transcribing = false;
      }
    };

    (async () => {
      try {
        const service = await device.getService(ENVSENSE_SERVICE_UUID);

        try {
          const codecChar = await service.getCharacteristic(AUDIO_CODEC_UUID);
          const codecBytes = await codecChar.read();
          const codecId = codecBytes[0];
          if (codecId !== AUDIO_CODEC_ID_OPUS) {
            console.warn(`Unexpected audio codec id ${codecId}; skipping STT pipeline`);
            return;
          }
        } catch (err) {
          console.warn('Could not read audio codec characteristic', err);
          return;
        }

        const audioChar = await service.getCharacteristic(AUDIO_DATA_UUID);
        unsubscribe = await audioChar.subscribe((array) => {
          if (cancelled) {
            return;
          }
          if (array.length <= AUDIO_PACKET_HEADER_SIZE) {
            return; // header-only packet
          }
          pendingFrames.push(array.slice(AUDIO_PACKET_HEADER_SIZE));
          if (pendingFrames.length >= FRAMES_PER_SEGMENT) {
            flush();
          }
        });
      } catch (err) {
        console.error('Failed to set up audio subscription', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [device]);

  return transcripts;
}
