#ifndef VAD_H
#define VAD_H

#include <Arduino.h>
#include <stdint.h>

// Voice activity detection over 20ms PCM frames, backed by esp-sr's esp_vad
// (WebRTC). Silence is dropped before the Opus encoder, which is where the
// always-on capture's power and storage savings come from. A PSRAM pre-roll
// ring keeps the last VAD_PREROLL_MS of PCM so the start of an utterance isn't
// clipped, and a VAD_HANGOVER_MS hangover bridges normal speech pauses.

// Receives voiced PCM (including the pre-roll flush when speech starts).
typedef void (*vad_pcm_handler)(int16_t *data, size_t samples);
// Fired on speech start (true) / end (false). On start, the utterance began
// roughly VAD_PREROLL_MS before the callback.
typedef void (*vad_state_handler)(bool speaking);

bool vad_init();
void vad_set_pcm_callback(vad_pcm_handler callback);
void vad_set_state_callback(vad_state_handler callback);
// Feed mic PCM (variable-length blocks); internally framed to 20ms for the VAD.
void vad_feed(int16_t *data, size_t samples);
bool vad_is_speaking();

#endif // VAD_H
