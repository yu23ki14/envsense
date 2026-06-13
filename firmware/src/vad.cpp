#include "vad.h"

#include "config.h"

#define VAD_FRAME_SAMPLES OPUS_FRAME_SAMPLES // 20ms @ 16kHz; energy is judged per Opus frame
#define VAD_FRAME_MS (VAD_FRAME_SAMPLES * 1000 / MIC_SAMPLE_RATE)
#define VAD_HANGOVER_FRAMES (VAD_HANGOVER_MS / VAD_FRAME_MS)
#define VAD_PREROLL_SAMPLES (MIC_SAMPLE_RATE * VAD_PREROLL_MS / 1000)

static vad_pcm_handler pcmCallback = nullptr;
static vad_state_handler stateCallback = nullptr;

// Pre-roll ring (PSRAM): the most recent VAD_PREROLL_MS of PCM while silent.
static int16_t *preroll = nullptr;
static size_t prerollWrite = 0;
static size_t prerollCount = 0;

// Incoming PCM arrives in mic-buffer-sized blocks (100ms); energy is computed
// per 20ms frame, so partial frames carry over between calls.
static int16_t frameBuf[VAD_FRAME_SAMPLES];
static size_t framePos = 0;

static bool speaking = false;
static uint32_t voicedRun = 0;
static uint32_t silentRun = 0;

#if VAD_DEBUG_LOG
static uint32_t debugMaxEnergy = 0;
static unsigned long debugLastLog = 0;
#endif

bool vad_init()
{
    preroll = (int16_t *) ps_malloc(VAD_PREROLL_SAMPLES * sizeof(int16_t));
    if (preroll == nullptr) {
        Serial.println("vad: failed to allocate pre-roll buffer");
        return false;
    }
    prerollWrite = 0;
    prerollCount = 0;
    return true;
}

void vad_set_pcm_callback(vad_pcm_handler callback)
{
    pcmCallback = callback;
}

void vad_set_state_callback(vad_state_handler callback)
{
    stateCallback = callback;
}

bool vad_is_speaking()
{
    return speaking;
}

static void prerollAppend(const int16_t *data, size_t samples)
{
    for (size_t i = 0; i < samples; i++) {
        preroll[prerollWrite] = data[i];
        prerollWrite = (prerollWrite + 1) % VAD_PREROLL_SAMPLES;
    }
    prerollCount += samples;
    if (prerollCount > VAD_PREROLL_SAMPLES) {
        prerollCount = VAD_PREROLL_SAMPLES;
    }
}

// Emit the buffered pre-roll, oldest first, in bounded slices so the consumer
// (the Opus PCM ring) sees the same block sizes it gets from the mic.
static void prerollFlush()
{
    static int16_t slice[VAD_FRAME_SAMPLES];
    size_t start = (prerollWrite + VAD_PREROLL_SAMPLES - prerollCount) % VAD_PREROLL_SAMPLES;
    size_t remaining = prerollCount;
    while (remaining > 0) {
        size_t n = remaining < VAD_FRAME_SAMPLES ? remaining : VAD_FRAME_SAMPLES;
        for (size_t i = 0; i < n; i++) {
            slice[i] = preroll[(start + i) % VAD_PREROLL_SAMPLES];
        }
        if (pcmCallback != nullptr) {
            pcmCallback(slice, n);
        }
        start = (start + n) % VAD_PREROLL_SAMPLES;
        remaining -= n;
    }
    prerollCount = 0;
}

static void processFrame(int16_t *frame)
{
    uint32_t sum = 0;
    for (size_t i = 0; i < VAD_FRAME_SAMPLES; i++) {
        sum += (uint32_t) abs((int32_t) frame[i]);
    }
    uint32_t energy = sum / VAD_FRAME_SAMPLES;

#if VAD_DEBUG_LOG
    if (energy > debugMaxEnergy) {
        debugMaxEnergy = energy;
    }
    if (millis() - debugLastLog >= 1000) {
        Serial.printf("vad: peak frame energy %lu (threshold %d, %s)\n",
                      (unsigned long) debugMaxEnergy,
                      VAD_THRESHOLD,
                      speaking ? "speaking" : "silent");
        debugMaxEnergy = 0;
        debugLastLog = millis();
    }
#endif

    bool voiced = energy >= VAD_THRESHOLD;

    if (!speaking) {
        if (voiced) {
            voicedRun++;
        } else {
            voicedRun = 0;
        }
        if (voicedRun >= VAD_TRIGGER_FRAMES) {
            speaking = true;
            silentRun = 0;
            if (stateCallback != nullptr) {
                stateCallback(true);
            }
            // The trigger frames themselves are still in the pre-roll, so the
            // flush includes them; the current frame follows below.
            prerollFlush();
        } else {
            prerollAppend(frame, VAD_FRAME_SAMPLES);
            return;
        }
    }

    if (pcmCallback != nullptr) {
        pcmCallback(frame, VAD_FRAME_SAMPLES);
    }

    if (voiced) {
        silentRun = 0;
    } else if (++silentRun >= VAD_HANGOVER_FRAMES) {
        speaking = false;
        voicedRun = 0;
        silentRun = 0;
        if (stateCallback != nullptr) {
            stateCallback(false);
        }
    }
}

void vad_process(int16_t *data, size_t samples)
{
    if (preroll == nullptr) {
        return;
    }
    size_t offset = 0;
    while (offset < samples) {
        size_t n = samples - offset;
        size_t space = VAD_FRAME_SAMPLES - framePos;
        if (n > space) {
            n = space;
        }
        memcpy(&frameBuf[framePos], &data[offset], n * sizeof(int16_t));
        framePos += n;
        offset += n;
        if (framePos == VAD_FRAME_SAMPLES) {
            framePos = 0;
            processFrame(frameBuf);
        }
    }
}
