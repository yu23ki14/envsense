#include "app.h"

#include <BLEAdvertisedDevice.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEUtils.h>
#include <Preferences.h>

#include "config.h" // Use config.h for all configurations
#include "driver/rtc_io.h"
#include "driver/touch_sensor.h" // IDF legacy touch_pad_* (Arduino touch HAL removed on S3 in IDF 5.5; v2 driver migration tracked in #72)
#include "esp_camera.h"
#include "esp_rom_crc.h"
#include "esp_sleep.h"
#include "mic.h"
#include "opus_encoder.h"
#include "ota.h"
#include "storage.h"
#include "vad.h"

// Device power state
bool deviceActive = true;
device_state_t deviceState = DEVICE_BOOTING;

// Button and LED state
volatile bool buttonPressed = false;
unsigned long buttonPressTime = 0;
led_status_t ledMode = LED_BOOT_SEQUENCE;

// Copper-foil touch sensor state (GPIO3 / TOUCH3)
RTC_DATA_ATTR uint32_t touchBaseline = 0; // Survives deep sleep; calibrated on cold boot
bool touchWaitRelease = false;            // After a touch wake-up, ignore the foil until released
volatile bool touchDebugLed = false;      // TOUCH_DEBUG_LOG: mirror the touch state on the LED

// BLE power commands, deferred to the main loop so the write response is sent
// before the BLE stack is torn down (see PowerControlCallback)
volatile bool powerOffRequested = false;
volatile bool rebootRequested = false;

// ---------------------------------------------------------------------------------
// BLE - Using config.h definitions
// ---------------------------------------------------------------------------------

// Device Information Service UUIDs
#define DEVICE_INFORMATION_SERVICE_UUID (uint16_t) 0x180A
#define MANUFACTURER_NAME_STRING_CHAR_UUID (uint16_t) 0x2A29
#define MODEL_NUMBER_STRING_CHAR_UUID (uint16_t) 0x2A24
#define FIRMWARE_REVISION_STRING_CHAR_UUID (uint16_t) 0x2A26
#define HARDWARE_REVISION_STRING_CHAR_UUID (uint16_t) 0x2A27
#define SERIAL_NUMBER_STRING_CHAR_UUID (uint16_t) 0x2A25

// Main envsense Service - using config.h UUIDs
static BLEUUID serviceUUID(ENVSENSE_SERVICE_UUID);
static BLEUUID photoDataUUID(PHOTO_DATA_UUID);
static BLEUUID photoControlUUID(PHOTO_CONTROL_UUID);
static BLEUUID powerControlUUID(POWER_CONTROL_UUID);
static BLEUUID audioDataUUID(AUDIO_DATA_UUID);
static BLEUUID audioCodecUUID(AUDIO_CODEC_UUID);
static BLEUUID syncStatusUUID(SYNC_STATUS_UUID);
static BLEUUID syncControlUUID(SYNC_CONTROL_UUID);
static BLEUUID syncDataUUID(SYNC_DATA_UUID);
static BLEUUID timeSyncUUID(TIME_SYNC_UUID);
static BLEUUID modeControlUUID(MODE_CONTROL_UUID);

// OTA Service UUIDs
static BLEUUID otaServiceUUID(OTA_SERVICE_UUID);
static BLEUUID otaControlUUID(OTA_CONTROL_UUID);
static BLEUUID otaDataUUID(OTA_DATA_UUID);

// Characteristics
BLECharacteristic *photoDataCharacteristic;
BLECharacteristic *photoControlCharacteristic;
BLECharacteristic *powerControlCharacteristic;
BLECharacteristic *audioDataCharacteristic;
BLECharacteristic *audioCodecCharacteristic;
BLECharacteristic *otaControlCharacteristic;
BLECharacteristic *otaDataCharacteristic;
BLECharacteristic *syncStatusCharacteristic;
BLECharacteristic *syncControlCharacteristic;
BLECharacteristic *syncDataCharacteristic;
BLECharacteristic *timeSyncCharacteristic;
BLECharacteristic *modeControlCharacteristic;

// Audio state
bool audioEnabled = true;
volatile bool audioSubscribed = false;
uint16_t audioPacketIndex = 0;
// Negotiated ATT MTU for the active connection (updated in onMtuChanged). The
// audio TX packs as many Opus frames as fit into each notification, so a larger
// MTU means fewer notifications for the same frame rate. 23 is the BLE default
// until the client negotiates higher.
volatile uint16_t negotiatedMtu = 23;

// State
bool connected = false;
bool isCapturingPhotos = false;
int captureInterval = 0; // Interval in ms
unsigned long lastCaptureTime = 0;

// Capture mode (CAPTURE_MODE_LOCAL / CAPTURE_MODE_STREAMING, see config.h).
// Holds the *effective* mode: a LOCAL request without a mounted card resolves
// to STREAMING. The requested mode is persisted in NVS and re-resolved at boot.
// BLE writes only set the request flags; the NVS write happens in loop_app.
volatile uint8_t captureMode = CAPTURE_MODE_LOCAL;
static volatile bool modeChangeRequested = false;
static volatile uint8_t requestedMode = 0;

// Audio ring buffer for encoded packets
#define AUDIO_TX_BUFFER_SIZE (AUDIO_TX_RING_BUFFER_SIZE * (OPUS_OUTPUT_MAX_BYTES + 2))
static uint8_t audio_tx_buffer[AUDIO_TX_BUFFER_SIZE];
static volatile size_t audio_tx_write_pos = 0;
static volatile size_t audio_tx_read_pos = 0;
// One BLE notification holds the 3-byte header plus several length-prefixed
// Opus frames, so it can be as large as the negotiated MTU.
static uint8_t audio_batch_buffer[BLE_MTU_SIZE];

size_t sent_photo_bytes = 0;
size_t sent_photo_frames = 0;
bool photoDataUploading = false;

// ---------------------------------------------------------------------------------
// SD-first capture / sync state
// ---------------------------------------------------------------------------------
// The utterance close is deferred to the audio task loop so it runs after
// opus_process() has encoded the final voiced PCM (the VAD state callback
// fires mid-mic_process, before encoding).
static volatile bool utteranceEndPending = false;

// TIME_SYNC writes are applied in loop_app: storage_set_time may rename files
// on the card, which is too slow for a BLE callback.
static volatile bool timeSyncPending = false;
static volatile uint64_t timeSyncValue = 0;

// Sync transfer state machine (loop_app). BLE callbacks only set the request
// flags; all SD reads and notifications happen in the loop.
typedef enum { SYNC_IDLE, SYNC_SENDING_MANIFEST, SYNC_SENDING_FILE } sync_state_t;
static sync_state_t syncState = SYNC_IDLE;
static volatile bool syncManifestRequested = false;
static volatile bool syncFileRequested = false;
static volatile uint32_t syncRequestedFileId = 0;
// Resume support: where in the file the app wants the transfer to start, and the
// app's running CRC32 over the bytes it already holds (both 0 for a fresh fetch).
static volatile uint32_t syncRequestedOffset = 0;
static volatile uint32_t syncRequestedCrc = 0;
static volatile bool syncAbortRequested = false;
static volatile bool syncPurgeRequested = false;
// Delete-all in progress (reflected to the app via SYNC_FLAG_PURGING). Set while
// storage_format() runs so the app sees the start->done transition in SYNC_STATUS.
static bool syncPurgeActive = false;
static volatile uint32_t syncAckQueue[8];
static volatile uint8_t syncAckHead = 0;
static volatile uint8_t syncAckTail = 0;

static manifest_entry_t *syncManifest = nullptr; // PSRAM, allocated on first manifest request
static int syncManifestCount = 0;
static bool syncManifestBuilt = false;
static int syncManifestSendIndex = 0;
static manifest_entry_t *syncFile = nullptr; // Entry currently being streamed
static uint32_t syncFileOffset = 0;
static uint16_t syncFileSeq = 0;
static uint32_t syncFileCrc = 0;
// Debug counter: how many times the current file's chunk send hit a full TX buffer (congestion
// backoff). Reset at file start, reported at FILE_END — a high count points at the BLE link, not SD.
static uint32_t syncFileCongestion = 0;
static uint8_t syncTxBuffer[BLE_MTU_SIZE];
// Set by SyncDataStatusCallback when a notify is rejected because the
// controller TX buffer is full. notify() reports this synchronously via
// onStatus(ERROR_GATT), so processSync() can read it right after notify().
static volatile bool syncTxFull = false;

// millis() of the last sync activity (a SYNC_CONTROL write or a sent chunk).
// syncSessionActive() debounces this by SYNC_ACTIVE_IDLE_MS so the loop stays
// in "dedicate to the transfer" mode across the short gaps between files.
static volatile unsigned long lastSyncActivityMs = 0;
static inline bool syncSessionActive()
{
    return lastSyncActivityMs != 0 && (millis() - lastSyncActivityMs) < SYNC_ACTIVE_IDLE_MS;
}
// True while photo/audio capture should stay suspended for an in-flight sync.
static inline bool syncCaptureSuspended()
{
#if SYNC_PAUSE_CAPTURE
    return syncSessionActive();
#else
    return false;
#endif
}

// Cross-core handshake to pause the mic during a sync session (SYNC_PAUSE_CAPTURE).
// loop_app (core0) requests the pause; audioTask (core1) owns the mic, so it is
// the only side that calls mic_stop()/mic_start() and signals back via audioPaused.
// This guarantees the PDM mic is fully stopped before loop_app raises the CPU
// frequency (the PDM clock can't survive SYNC_BOOST_CPU_MHZ).
static volatile bool audioPauseRequested = false;
static volatile bool audioPaused = false;

// -------------------------------------------------------------------------
// Camera Frame
// -------------------------------------------------------------------------
camera_fb_t *fb = nullptr;
image_orientation_t current_photo_orientation = ORIENTATION_0_DEGREES;
// True while the camera is initialized. The sensor is deinitialized between
// interval captures to save power, so this gates camera_ensure_on/camera_off.
bool cameraActive = false;

// Forward declarations
void handlePhotoControl(int8_t controlValue);
void IRAM_ATTR buttonISR();
void handleButton();
void setupTouch();
void handleTouch();
void updateLED();
void blinkLED(int count, int delayMs);
void shutdownDevice();

// Audio forward declarations
void onMicData(int16_t *data, size_t samples);
void onOpusEncoded(uint8_t *data, size_t len);
void processAudioTx();

// Sync forward declarations
void updateSyncStatus(bool notifyApp);
void processSync();

// Verbose sync trace (config.h SYNC_DEBUG_LOG). Each line is prefixed with millis() so it can be
// lined up against the app-side [sync +Nms] logs while debugging stalled transfers.
#if SYNC_DEBUG_LOG
#define SYNC_LOG(fmt, ...) Serial.printf("[%lu] sync: " fmt "\n", (unsigned long) millis(), ##__VA_ARGS__)
#else
#define SYNC_LOG(...) ((void) 0)
#endif

// Capture mode forward declarations
void applyCaptureMode(uint8_t mode);
void publishCaptureMode(bool notifyApp);

// -------------------------------------------------------------------------
// Button ISR
// -------------------------------------------------------------------------
void IRAM_ATTR buttonISR()
{
    buttonPressed = true;
}

// -------------------------------------------------------------------------
// LED Functions
// -------------------------------------------------------------------------
void updateLED()
{
    unsigned long now = millis();
    static unsigned long bootStartTime = 0;
    static unsigned long powerOffStartTime = 0;

    // GPIO21 is shared between the user LED and the SD card's chip select
    // (XIAO ESP32S3 Sense). Once the card is mounted the LED must never be
    // driven again -- toggling CS mid-transaction corrupts the filesystem.
    // Power-off still works; it just skips the farewell blink.
    if (storage_available()) {
        if (ledMode == LED_POWER_OFF_SEQUENCE) {
            shutdownDevice();
        }
        return;
    }

    switch (ledMode) {
    case LED_BOOT_SEQUENCE:
        if (bootStartTime == 0)
            bootStartTime = now;

        // 5 quick blinks over 1.5 seconds total (inverted logic: HIGH=OFF, LOW=ON)
        if (now - bootStartTime < 1500) {
            int blinkPhase = ((now - bootStartTime) / 150) % 2;
            digitalWrite(STATUS_LED_PIN, !blinkPhase);
        } else {
            digitalWrite(STATUS_LED_PIN, HIGH); // OFF
            ledMode = LED_NORMAL_OPERATION;
            bootStartTime = 0;
        }
        break;

    case LED_POWER_OFF_SEQUENCE:
        if (powerOffStartTime == 0)
            powerOffStartTime = now;

        // 2 quick blinks over 800ms total (inverted logic: HIGH=OFF, LOW=ON)
        if (now - powerOffStartTime < 800) {
            int blinkPhase = ((now - powerOffStartTime) / 200) % 2;
            digitalWrite(STATUS_LED_PIN, !blinkPhase);
        } else {
            digitalWrite(STATUS_LED_PIN, HIGH); // OFF
            delay(100);
            shutdownDevice();
        }
        break;

    case LED_NORMAL_OPERATION:
    default:
        if (connected) {
            // Connected - LED solid ON
            digitalWrite(STATUS_LED_PIN, LOW);
        } else {
            // Disconnected - LED slow blink (1 sec on, 1 sec off)
            int blinkPhase = (now / 1000) % 2;
            digitalWrite(STATUS_LED_PIN, blinkPhase ? HIGH : LOW);
        }
        break;
    }
}

void blinkLED(int count, int delayMs)
{
    for (int i = 0; i < count; i++) {
        digitalWrite(STATUS_LED_PIN, HIGH);
        delay(delayMs);
        digitalWrite(STATUS_LED_PIN, LOW);
        delay(delayMs);
    }
}

// -------------------------------------------------------------------------
// Button Handling
// -------------------------------------------------------------------------
void handleButton()
{
    unsigned long now = millis();
    static unsigned long lastDebounceTime = 0;
    static bool buttonDown = false;
    static bool longPressTriggered = false;

    bool currentButtonState = !digitalRead(POWER_BUTTON_PIN); // Active low (pressed = true)

    if (currentButtonState && !buttonDown) {
        // Button just pressed - debounce
        if (now - lastDebounceTime < 50) {
            return;
        }
        buttonPressTime = now;
        buttonDown = true;
        longPressTriggered = false;
        lastDebounceTime = now;

    } else if (currentButtonState && buttonDown && !longPressTriggered) {
        // Button still held - check for long press
        unsigned long pressDuration = now - buttonPressTime;
        if (pressDuration >= 2000) {
            // Long press threshold reached - trigger power off immediately
            longPressTriggered = true;
            ledMode = LED_POWER_OFF_SEQUENCE;
        }

    } else if (!currentButtonState && buttonDown) {
        // Button just released - debounce
        if (now - lastDebounceTime < 50) {
            return;
        }
        buttonDown = false;
        lastDebounceTime = now;
        longPressTriggered = false;
    }

    buttonPressed = false;
}

// -------------------------------------------------------------------------
// Touch Handling (copper foil on GPIO3 / TOUCH3)
// -------------------------------------------------------------------------
static inline uint32_t touchOnThreshold()
{
    return (uint32_t) (touchBaseline * (1.0f + TOUCH_TOUCH_RATIO));
}

static inline uint32_t touchOffThreshold()
{
    return (uint32_t) (touchBaseline * (1.0f + TOUCH_RELEASE_RATIO));
}

// One raw capacitance read of the foil channel via the IDF legacy driver. On
// the ESP32-S3 the channel id equals the GPIO number, so TOUCH_SENSE_PIN (GPIO3)
// is TOUCH_PAD_NUM3. A touch raises the value, matching the old touchRead scale.
static uint32_t touchReadRaw()
{
    uint32_t raw = 0;
    touch_pad_read_raw_data((touch_pad_t) TOUCH_SENSE_PIN, &raw);
    return raw;
}

// Median of TOUCH_FILTER_SAMPLES raw reads; on battery power single samples
// spike too much (camera / BLE load on the supply rail) to act on directly.
static uint32_t touchReadFiltered()
{
    uint32_t s[TOUCH_FILTER_SAMPLES];
    for (int i = 0; i < TOUCH_FILTER_SAMPLES; i++) {
        s[i] = touchReadRaw();
    }
    // Insertion sort - the array is tiny
    for (int i = 1; i < TOUCH_FILTER_SAMPLES; i++) {
        uint32_t v = s[i];
        int j = i - 1;
        while (j >= 0 && s[j] > v) {
            s[j + 1] = s[j];
            j--;
        }
        s[j + 1] = v;
    }
    return s[TOUCH_FILTER_SAMPLES / 2];
}

void setupTouch()
{
    // IDF 5.5 removed the Arduino touch HAL on the ESP32-S3, so drive the copper
    // foil through the IDF legacy touch_pad_* driver. Longer charge integration
    // than the default gives a better SNR, required for the low thresholds that
    // battery-powered (floating-ground) touch needs.
    touch_pad_init();
    touch_pad_set_fsm_mode(TOUCH_FSM_MODE_TIMER);
    touch_pad_config((touch_pad_t) TOUCH_SENSE_PIN);
    touch_pad_set_charge_discharge_times(TOUCH_MEASURE_CYCLES);
    touch_pad_set_measurement_interval(TOUCH_SLEEP_CYCLES);
    touch_pad_fsm_start();
    delay(10); // Let the FSM complete a few measurements before the first read

    if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TOUCHPAD && touchBaseline > 0) {
        // Woken by the foil: keep the baseline stored in RTC memory and ignore
        // the touch still in progress so we don't immediately power off again.
        touchWaitRelease = true;
    } else {
        // Cold boot or button wake: calibrate assuming the foil is untouched.
        for (int i = 0; i < 4; i++) {
            touchReadRaw(); // Discard warm-up readings
        }
        uint64_t sum = 0;
        for (int i = 0; i < TOUCH_BASELINE_SAMPLES; i++) {
            sum += touchReadRaw();
            delay(10);
        }
        touchBaseline = (uint32_t) (sum / TOUCH_BASELINE_SAMPLES);
    }
    Serial.printf("Touch baseline: %lu, on/off thresholds: %lu / %lu\n",
                  (unsigned long) touchBaseline,
                  (unsigned long) touchOnThreshold(),
                  (unsigned long) touchOffThreshold());
}

void handleTouch()
{
    unsigned long now = millis();
    static unsigned long lastSampleTime = 0;
    static unsigned long touchStartTime = 0;
    static bool touchDown = false;
    static bool touched = false;
    static float baselineF = 0.0f;

    if (touchBaseline == 0 || now - lastSampleTime < TOUCH_SAMPLE_INTERVAL_MS) {
        return;
    }
    lastSampleTime = now;
    if (baselineF == 0.0f) {
        baselineF = (float) touchBaseline;
    }

    uint32_t filtered = touchReadFiltered();

    // Hysteresis: entering the touched state takes a higher value than leaving
    // it, so readings hovering near a single threshold don't chatter.
    if (!touched && filtered > touchOnThreshold()) {
        touched = true;
    } else if (touched && filtered < touchOffThreshold()) {
        touched = false;
    }

    // While released, track drift (temperature / battery voltage / mounting)
    // with a slow EMA so the relative thresholds stay valid. Frozen while
    // touched, and asymmetric otherwise: upward movement is tracked 10x
    // slower so a sub-threshold touch (the shrunken delta when running on
    // battery with a floating ground) is not absorbed into the baseline.
    if (!touched && !touchWaitRelease) {
        float err = (float) filtered - baselineF;
        baselineF += err * (err < 0 ? TOUCH_BASELINE_ALPHA : TOUCH_BASELINE_ALPHA_UP);
        touchBaseline = (uint32_t) baselineF; // RTC copy also feeds the deep-sleep wake threshold
    }

#if TOUCH_DEBUG_LOG
    touchDebugLed = touched;
    static unsigned long lastLogTime = 0;
    if (now - lastLogTime >= 1000) {
        Serial.printf("Touch filtered: %lu baseline: %lu (on: %lu / off: %lu)\n",
                      (unsigned long) filtered,
                      (unsigned long) touchBaseline,
                      (unsigned long) touchOnThreshold(),
                      (unsigned long) touchOffThreshold());
        lastLogTime = now;
    }
#endif

    if (touchWaitRelease) {
        if (!touched) {
            touchWaitRelease = false;
        }
        return;
    }

    if (touched && !touchDown) {
        touchDown = true;
        touchStartTime = now;
    } else if (touched && touchDown) {
        // A short touch does nothing; only a continuous hold powers off
        if (now - touchStartTime >= TOUCH_HOLD_OFF_MS && ledMode != LED_POWER_OFF_SEQUENCE) {
            Serial.println("Touch hold detected - powering off");
            ledMode = LED_POWER_OFF_SEQUENCE;
        }
    } else if (!touched) {
        touchDown = false;
    }
}

// -------------------------------------------------------------------------
// Power Management
// -------------------------------------------------------------------------
void shutdownDevice()
{
    Serial.println("Shutting down device...");

    // Stop audio. The audio task checks mic_is_running() once per iteration,
    // so give an in-flight encode/SD-write pass time to finish before the
    // card is unmounted underneath it.
    mic_stop();
    delay(150);

    // Close the open utterance and unmount the card before anything touches
    // GPIO21 (shared LED / SD CS pin).
    storage_shutdown();

    // Stop photo capture
    isCapturingPhotos = false;

    // Power down the camera before deep sleep. The XIAO ESP32S3 Sense wires the
    // OV2640 with no PWDN pin (PWDN_GPIO_NUM == -1), so esp_camera_deinit() --
    // which stops the XCLK the sensor runs off of -- is the only way to drop its
    // draw. Without this the sensor stays clocked through deep sleep and pulls
    // several mA continuously, dwarfing the ESP32's own ~10uA and flattening the
    // battery in a couple of hours.
    esp_camera_deinit();

    // Disconnect BLE gracefully
    if (connected) {
        Serial.println("Disconnecting BLE...");
    }

    // Turn off LED (inverted logic)
    digitalWrite(STATUS_LED_PIN, HIGH);

    // Clear every wake source configured during normal operation - the light
    // sleep timer in particular persists and would re-boot the device a few
    // seconds after power off.
    esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);

    // Enter deep sleep. Touch wake-up cannot coexist with ext0 on the ESP32-S3,
    // so the power button wakes via ext1 instead (same behavior: wake on LOW).
    // Keep the RTC peripherals powered so the internal pull-up on the button
    // pin stays active during deep sleep (otherwise the pin floats and drifts
    // low, waking the device on its own).
    rtc_gpio_pullup_en((gpio_num_t) POWER_BUTTON_PIN);
    rtc_gpio_pulldown_dis((gpio_num_t) POWER_BUTTON_PIN);
    esp_sleep_enable_ext1_wakeup(1ULL << POWER_BUTTON_PIN, ESP_EXT1_WAKEUP_ALL_LOW);
    esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);
    // Wake when the foil's reading rises far enough above its benchmark. The
    // IDF sleep threshold is a *delta above the hardware-tracked benchmark*
    // (touch_pad_set_thresh: "the original value of the trigger state minus the
    // benchmark"), not an absolute level like the in-loop detector's
    // touchOnThreshold(). So pass baseline * ratio (the rise a touch produces),
    // not baseline * (1 + ratio) -- the latter is ~baseline counts and a finger
    // never lifts the reading that far, so the device would never wake.
    touch_pad_sleep_channel_enable((touch_pad_t) TOUCH_SENSE_PIN, true);
    touch_pad_sleep_set_threshold((touch_pad_t) TOUCH_SENSE_PIN, (uint32_t) (touchBaseline * TOUCH_TOUCH_RATIO));
    esp_sleep_enable_touchpad_wakeup();
    Serial.println("Entering deep sleep...");
    delay(100);
    esp_deep_sleep_start();
}

// -------------------------------------------------------------------------
// Capture Mode (LOCAL = SD-first, STREAMING = BLE live with SD fallback)
// -------------------------------------------------------------------------
static uint8_t loadPersistedMode()
{
    Preferences prefs;
    if (!prefs.begin("envsense", true)) {
        return 0; // Namespace doesn't exist yet (first boot)
    }
    uint8_t mode = prefs.getUChar("mode", 0);
    prefs.end();
    return mode;
}

static void persistMode(uint8_t mode)
{
    Preferences prefs;
    if (prefs.begin("envsense", false)) {
        prefs.putUChar("mode", mode);
        prefs.end();
    }
}

// Mirror the effective mode into the characteristic so reads and (on change)
// notifications always reflect what the device is actually doing.
void publishCaptureMode(bool notifyApp)
{
    if (modeControlCharacteristic == nullptr) {
        return;
    }
    uint8_t value = captureMode;
    modeControlCharacteristic->setValue(&value, 1);
    if (notifyApp && connected) {
        modeControlCharacteristic->notify();
    }
}

// Resolve and switch to a capture mode. LOCAL needs the card: without one the
// device keeps running in STREAMING, and the publish below tells the app the
// effective mode (its request is still persisted, so inserting a card and
// rebooting honors it).
void applyCaptureMode(uint8_t mode)
{
    if (mode == CAPTURE_MODE_LOCAL && !storage_available()) {
        mode = CAPTURE_MODE_STREAMING;
    }
    if (mode == CAPTURE_MODE_STREAMING && connected) {
        // Stop recording the open utterance to the SD; speech from here on
        // goes out live. Closed by the audio task after the trailing frames.
        utteranceEndPending = true;
    }
    captureMode = mode;
    // Live photo upload follows the mode; the app can still override it per
    // connection through PHOTO_CONTROL (stop / single shot).
    isCapturingPhotos = (mode == CAPTURE_MODE_STREAMING);
    captureInterval = PHOTO_CAPTURE_INTERVAL_MS;
    publishCaptureMode(true);
    Serial.printf("Capture mode: %s\n", mode == CAPTURE_MODE_LOCAL ? "local" : "streaming");
}

// -------------------------------------------------------------------------
// Audio Functions
// -------------------------------------------------------------------------
void onMicData(int16_t *data, size_t samples)
{
    // The VAD decides what reaches the encoder: silence stays in its pre-roll
    // ring and is never encoded or stored.
    vad_feed(data, samples);
}

// Voiced PCM only (pre-roll flush + live frames while speaking).
void onVoicedPcm(int16_t *data, size_t samples)
{
    opus_receive_pcm(data, samples);
}

void onVadStateChange(bool speaking)
{
    if (speaking) {
        // LOCAL records every utterance to the SD. STREAMING sends speech live
        // instead and only records to the SD while disconnected (out-of-range
        // fallback); an utterance straddling a reconnect keeps writing to its
        // file until it ends.
        bool recordToSd = storage_available() && (captureMode == CAPTURE_MODE_LOCAL || !connected);
        if (!recordToSd) {
            return;
        }
        uint64_t now = storage_now_ms();
        uint64_t start = now > VAD_PREROLL_MS ? now - VAD_PREROLL_MS : now;
        storage_audio_begin_utterance(start);
    } else {
        // Close after opus_process() has encoded the trailing frames.
        utteranceEndPending = true;
    }
}

void onOpusEncoded(uint8_t *data, size_t len)
{
    if (len > OPUS_OUTPUT_MAX_BYTES) {
        return;
    }

    // Frames land in the current utterance file when one is open (LOCAL mode,
    // or the STREAMING out-of-range fallback; see onVadStateChange). The BLE
    // TX ring below is the live stream, served in STREAMING mode to an app
    // that subscribed.
    if (storage_audio_utterance_open()) {
        storage_audio_write_frame(data, (uint16_t) len);
    }
    if (captureMode != CAPTURE_MODE_STREAMING || !connected || !audioSubscribed) {
        return;
    }

    // Write length (2 bytes) + data
    size_t packet_size = len + 2;
    size_t next_write = (audio_tx_write_pos + packet_size) % AUDIO_TX_BUFFER_SIZE;

    // Check for buffer overflow
    if ((audio_tx_write_pos < audio_tx_read_pos && next_write >= audio_tx_read_pos) ||
        (audio_tx_write_pos >= audio_tx_read_pos && next_write < audio_tx_write_pos &&
         next_write >= audio_tx_read_pos)) {
        // Buffer full, skip this packet
        return;
    }

    // Write length
    audio_tx_buffer[audio_tx_write_pos] = len & 0xFF;
    audio_tx_buffer[(audio_tx_write_pos + 1) % AUDIO_TX_BUFFER_SIZE] = (len >> 8) & 0xFF;

    // Write data
    for (size_t i = 0; i < len; i++) {
        audio_tx_buffer[(audio_tx_write_pos + 2 + i) % AUDIO_TX_BUFFER_SIZE] = data[i];
    }

    audio_tx_write_pos = next_write;
}

// Drain the encoded-frame ring buffer to BLE, packing as many Opus frames as
// fit into each notification. Packet layout:
//   [0..1] 16-bit LE packet index
//   [2]    frame count N
//   then N times: [1-byte frame length][frame bytes]
// One frame per notification wastes the MTU (a frame is <=160 B but the MTU is
// ~512 B); batching lets the full 50 frames/s fit in far fewer notifications,
// so the connection interval no longer bottlenecks the stream. The companion
// app parses this same layout in useDeviceCapture.
void processAudioTx()
{
    if (!connected || !audioSubscribed || audioDataCharacteristic == nullptr) {
        return;
    }

    // A notification's value can be at most ATT_MTU - 3 bytes.
    size_t maxValue = (negotiatedMtu > 6) ? (size_t) (negotiatedMtu - 3) : 20;
    if (maxValue > sizeof(audio_batch_buffer)) {
        maxValue = sizeof(audio_batch_buffer);
    }

    while (audio_tx_read_pos != audio_tx_write_pos) {
        audio_batch_buffer[0] = audioPacketIndex & 0xFF;
        audio_batch_buffer[1] = (audioPacketIndex >> 8) & 0xFF;
        size_t pos = AUDIO_PACKET_HEADER_SIZE; // frame count goes in byte [2]
        uint8_t count = 0;

        while (audio_tx_read_pos != audio_tx_write_pos) {
            // Peek the next frame length (2-byte LE) without consuming it.
            uint16_t len = audio_tx_buffer[audio_tx_read_pos] |
                           (audio_tx_buffer[(audio_tx_read_pos + 1) % AUDIO_TX_BUFFER_SIZE] << 8);

            if (len == 0 || len > OPUS_OUTPUT_MAX_BYTES) {
                // Corrupt entry: skip its length field and continue.
                audio_tx_read_pos = (audio_tx_read_pos + 2) % AUDIO_TX_BUFFER_SIZE;
                continue;
            }

            // Stop the batch if this frame won't fit -- but always include at
            // least one frame so the buffer keeps draining even on a tiny MTU.
            if (count > 0 && pos + 1 + len > maxValue) {
                break;
            }

            // Consume the length field, then copy the frame bytes.
            audio_tx_read_pos = (audio_tx_read_pos + 2) % AUDIO_TX_BUFFER_SIZE;
            audio_batch_buffer[pos++] = (uint8_t) len;
            for (uint16_t i = 0; i < len; i++) {
                audio_batch_buffer[pos++] = audio_tx_buffer[audio_tx_read_pos];
                audio_tx_read_pos = (audio_tx_read_pos + 1) % AUDIO_TX_BUFFER_SIZE;
            }

            if (++count == 255 || pos + 2 > maxValue) {
                break;
            }
        }

        if (count == 0) {
            break;
        }
        audio_batch_buffer[2] = count;
        audioDataCharacteristic->setValue(audio_batch_buffer, pos);
        audioDataCharacteristic->notify();
        audioPacketIndex++;

        // Brief yield so the BLE stack can flush instead of overflowing its TX.
        delay(1);
    }
}

// 音声キャプチャ + Opus エンコードは専用タスクで回す。
// opus_encode() は十数 KB のスタックを使い、Arduino の loopTask(8KB) で回すと
// スタックオーバーフローや割り込みウォッチドッグ(TG1WDT)リセットを起こすため。
// mic_process() 内の i2s_read がブロッキングで自然に yield するので、CPU を独占しない。
static TaskHandle_t audioTaskHandle = nullptr;

void audioTask(void *param)
{
    for (;;) {
        // 同期セッション中はマイクを止めて転送に CPU/SD を明け渡す(SYNC_PAUSE_CAPTURE)。
        // マイクの所有者はこのタスクなので mic_stop()/mic_start() はここだけで呼び、
        // loop_app(core0) とは audioPauseRequested/audioPaused でハンドシェイクする。
        // これにより loop_app が CPU を昇圧する前に PDM が確実に停止している。
        if (audioPauseRequested) {
            if (!audioPaused) {
                // 開いている発話があれば末尾まで書き切ってから止める。
                if (utteranceEndPending) {
                    utteranceEndPending = false;
                    storage_audio_end_utterance();
                }
                if (mic_is_running()) {
                    mic_stop();
                }
                audioPaused = true;
            }
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        if (audioPaused) {
            // 再開: loop_app が先に CPU を NORMAL へ戻してから要求を下げているので、
            // ここでマイクを起こすときには既に安全なクロックに戻っている。
            if (audioEnabled) {
                mic_start();
            }
            audioPaused = false;
        }

        // SDファースト化により常時キャプチャする（接続有無に依存しない）。
        // VAD が無音を落とすので、無音中は opus_process() がエンコードする
        // フレーム自体が無く、CPU と SD への負荷は発話中だけに収まる。
        if (audioEnabled && mic_is_running()) {
            mic_process(); // i2s_read でブロック → 他タスク/割り込みに譲る
            opus_process();
            // 発話終了は opus_process が末尾フレームを書き終えた後に確定させる
            if (utteranceEndPending) {
                utteranceEndPending = false;
                storage_audio_end_utterance();
            }
            // 送信もこのタスク内で即ドレインする。loop_app(core0)で送ると写真送信
            // などでループが詰まる間に TX リングが溢れてフレームを落とすため、
            // producer(opus_process)と同じ core1 タスクで直後に送って溢れを防ぐ。
            // 両者が同一タスク=逐次実行なのでリングの read/write は競合しない。
            processAudioTx();
            vTaskDelay(1); // 毎周回 必ず yield して loopTask/idle/割り込みを飢餓させない
        } else {
            vTaskDelay(pdMS_TO_TICKS(10));
        }
    }
}

// -------------------------------------------------------------------------
// BLE Callbacks
// -------------------------------------------------------------------------
class ServerHandler : public BLEServerCallbacks
{
    void onConnect(BLEServer *server) override
    {
        connected = true;
        audioSubscribed = false;
        Serial.println(">>> BLE Client connected.");
        // Send unsynced stats and capture mode on connect
        updateSyncStatus(true);
        publishCaptureMode(true);
    }
    void onConnect(BLEServer *server, ble_gap_conn_desc *desc) override
    {
        // Ask the central for a short connection interval. This is the main
        // lever for bulk-sync throughput: with the BLE-default ~30-50 ms
        // interval the controller sends only a couple of notifications per
        // event, so a multi-MB transfer takes many minutes.
        server->requestConnParams(
            desc->conn_handle, SYNC_CONN_INTERVAL_MIN, SYNC_CONN_INTERVAL_MAX, 0, SYNC_CONN_SUPERVISION_TIMEOUT);
    }
    void onDisconnect(BLEServer *server) override
    {
        connected = false;
        audioSubscribed = false;
        negotiatedMtu = 23; // back to the BLE default until the next negotiation
        // Drop any in-flight sync transfer; the manifest ids are connection-
        // scoped, so the app starts over from SYNC_CMD_MANIFEST on reconnect.
        syncAbortRequested = true;
        if (syncState == SYNC_SENDING_FILE && syncFile != nullptr) {
            SYNC_LOG("DISCONNECT mid-file %lu at offset %lu/%lu",
                     (unsigned long) syncFile->id,
                     (unsigned long) syncFileOffset,
                     (unsigned long) syncFile->size);
        } else if (syncState != SYNC_IDLE) {
            SYNC_LOG("DISCONNECT mid-sync (state=%d)", (int) syncState);
        }
        Serial.println("<<< BLE Client disconnected. Restarting advertising.");
        BLEDevice::startAdvertising();
    }
    void onMtuChanged(BLEServer *server, ble_gap_conn_desc *desc, uint16_t mtu) override
    {
        negotiatedMtu = mtu;
        Serial.printf("MTU negotiated: %u\n", negotiatedMtu);
    }
};

class AudioDataCallback : public BLECharacteristicCallbacks
{
    void onStatus(BLECharacteristic *pCharacteristic, Status s, uint32_t code)
    {
        if (s == Status::SUCCESS_NOTIFY || s == Status::SUCCESS_INDICATE) {
            // Notification sent successfully
        }
    }

    void onRead(BLECharacteristic *pCharacteristic)
    {
        // Client read the characteristic
    }

    // NimBLE reports CCCD subscribe/unsubscribe here (the 0x2902 descriptor is
    // auto-created and has no separate write callback). bit0 = notifications.
    void onSubscribe(BLECharacteristic *pCharacteristic, ble_gap_conn_desc *desc, uint16_t subValue) override
    {
        audioSubscribed = (subValue & 0x0001) != 0;
        Serial.println(audioSubscribed ? "Audio notifications enabled" : "Audio notifications disabled");
    }
};

class PhotoControlCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        if (characteristic->getLength() == 1) {
            int8_t received = characteristic->getData()[0];
            Serial.print("PhotoControl received: ");
            Serial.println(received);
            handlePhotoControl(received);
        }
    }
};

class ModeControlCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        if (characteristic->getLength() == 1) {
            uint8_t mode = characteristic->getData()[0];
            Serial.printf("ModeControl received: 0x%02X\n", mode);
            // Applied in loop_app: the NVS write is too slow for a BLE callback
            requestedMode = mode;
            modeChangeRequested = true;
        }
    }
};

class PowerControlCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        if (characteristic->getLength() == 1) {
            uint8_t command = characteristic->getData()[0];
            Serial.printf("PowerControl received: 0x%02X\n", command);
            if (command == POWER_CMD_SLEEP) {
                powerOffRequested = true;
            } else if (command == POWER_CMD_REBOOT) {
                rebootRequested = true;
            }
        }
    }
};

// Sync commands only set flags here; the SD work and the notifications all
// happen in processSync() on the main loop (BLE callbacks must stay fast).
class SyncControlCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        uint8_t *data = characteristic->getData();
        size_t len = characteristic->getLength();
        if (len < 1) {
            return;
        }
        uint32_t fileId = 0;
        if (len >= 5) {
            fileId = (uint32_t) data[1] | ((uint32_t) data[2] << 8) | ((uint32_t) data[3] << 16) |
                     ((uint32_t) data[4] << 24);
        }
        // Any control command means the app is mid-sync: keep the session alive so
        // loop_app stays in flat-out mode and capture stays paused.
        lastSyncActivityMs = millis();
        switch (data[0]) {
        case SYNC_CMD_MANIFEST:
            syncManifestRequested = true;
            SYNC_LOG("<- MANIFEST");
            break;
        case SYNC_CMD_GET_FILE:
            syncRequestedFileId = fileId;
            // Optional resume params: [u32 offset][u32 crcSeed] after the id. A
            // legacy 5-byte request omits them and restarts the file from 0.
            if (len >= 13) {
                syncRequestedOffset = (uint32_t) data[5] | ((uint32_t) data[6] << 8) | ((uint32_t) data[7] << 16) |
                                      ((uint32_t) data[8] << 24);
                syncRequestedCrc = (uint32_t) data[9] | ((uint32_t) data[10] << 8) | ((uint32_t) data[11] << 16) |
                                   ((uint32_t) data[12] << 24);
            } else {
                syncRequestedOffset = 0;
                syncRequestedCrc = 0;
            }
            syncFileRequested = true;
            SYNC_LOG("<- GET_FILE id=%lu offset=%lu crcSeed=%08lx",
                     (unsigned long) syncRequestedFileId,
                     (unsigned long) syncRequestedOffset,
                     (unsigned long) syncRequestedCrc);
            break;
        case SYNC_CMD_ACK_FILE: {
            uint8_t nextHead = (syncAckHead + 1) % 8;
            if (nextHead != syncAckTail) { // Queue full: drop; the app retries unacked files next sync
                syncAckQueue[syncAckHead] = fileId;
                syncAckHead = nextHead;
                SYNC_LOG("<- ACK id=%lu", (unsigned long) fileId);
            } else {
                SYNC_LOG("<- ACK id=%lu DROPPED (queue full)", (unsigned long) fileId);
            }
            break;
        }
        case SYNC_CMD_ABORT:
            syncAbortRequested = true;
            SYNC_LOG("<- ABORT");
            break;
        case SYNC_CMD_PURGE:
            syncPurgeRequested = true;
            SYNC_LOG("<- PURGE");
            break;
        default:
            SYNC_LOG("<- unknown cmd 0x%02x (len=%u)", data[0], (unsigned) len);
            break;
        }
    }
};

// Flow control for the sync data stream. The standard BLE notify() silently
// drops a packet when the controller TX buffer is full (rc != ESP_OK), which
// used to corrupt transfers: a dropped FILE_END left the app waiting until its
// per-file timeout, and a dropped chunk broke the sequence. We catch that here
// so processSync() only advances after a notify is actually accepted.
class SyncDataStatusCallback : public BLECharacteristicCallbacks
{
    void onStatus(BLECharacteristic *characteristic, Status s, uint32_t code) override
    {
        if (s == Status::ERROR_GATT) {
            syncTxFull = true;
        }
    }
};

class TimeSyncCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        if (characteristic->getLength() != 8) {
            return;
        }
        uint8_t *data = characteristic->getData();
        uint64_t epochMs = 0;
        for (int i = 7; i >= 0; i--) {
            epochMs = (epochMs << 8) | data[i];
        }
        timeSyncValue = epochMs;
        timeSyncPending = true; // Applied in loop_app: may rename files on SD
    }
};

// -------------------------------------------------------------------------
// Sync (microSD -> app bulk transfer over SYNC_DATA notifications)
// -------------------------------------------------------------------------
void updateSyncStatus(bool notifyApp)
{
    if (syncStatusCharacteristic == nullptr) {
        return;
    }
    uint16_t audioCount = 0;
    uint16_t photoCount = 0;
    uint32_t totalBytes = 0;
    storage_stats(&audioCount, &photoCount, &totalBytes);
    uint8_t flags = 0;
    if (storage_available()) {
        flags |= SYNC_FLAG_SD_OK;
    }
    if (storage_clock_valid()) {
        flags |= SYNC_FLAG_CLOCK_VALID;
    }
    if (syncPurgeActive) {
        flags |= SYNC_FLAG_PURGING; // App watches this drop to detect delete-all completion.
    }
    uint8_t payload[9];
    payload[0] = audioCount & 0xFF;
    payload[1] = audioCount >> 8;
    payload[2] = photoCount & 0xFF;
    payload[3] = photoCount >> 8;
    memcpy(&payload[4], &totalBytes, 4);
    payload[8] = flags;
    syncStatusCharacteristic->setValue(payload, sizeof(payload));
    if (notifyApp && connected) {
        syncStatusCharacteristic->notify();
    }
}

// One notification's worth of usable bytes for the current connection.
static size_t syncMaxValue()
{
    size_t maxValue = (negotiatedMtu > 10) ? (size_t) (negotiatedMtu - 3) : 20;
    if (maxValue > sizeof(syncTxBuffer)) {
        maxValue = sizeof(syncTxBuffer);
    }
    return maxValue;
}

static manifest_entry_t *findManifestEntry(uint32_t id)
{
    if (!syncManifestBuilt || id == 0 || id > (uint32_t) syncManifestCount) {
        return nullptr;
    }
    return &syncManifest[id - 1]; // Ids are assigned 1..count at build time
}

static void syncSendFileError(uint32_t id)
{
    syncTxBuffer[0] = SYNC_PKT_ERROR;
    memcpy(&syncTxBuffer[1], &id, 4);
    syncDataCharacteristic->setValue(syncTxBuffer, 5);
    syncDataCharacteristic->notify();
}

// Notify the current syncTxBuffer contents and report whether the BLE stack
// accepted the packet. notify() invokes SyncDataStatusCallback synchronously,
// so syncTxFull reflects this exact packet by the time notify() returns. A
// false return means the TX buffer was full and the packet was dropped — the
// caller must back off and resend the same packet without advancing state.
static bool syncNotify(size_t len)
{
    syncTxFull = false;
    syncDataCharacteristic->setValue(syncTxBuffer, len);
    syncDataCharacteristic->notify();
    lastSyncActivityMs = millis(); // Keep the sync session alive while chunks flow
    return !syncTxFull;
}

// Drives the sync transfer a bounded amount per loop_app() pass so the touch
// sensor / button / photo capture stay responsive during multi-minute syncs.
void processSync()
{
    if (syncAbortRequested) {
        syncAbortRequested = false;
        if (syncState != SYNC_IDLE) {
            SYNC_LOG("abort: state=%d, dropping in-flight transfer", (int) syncState);
        }
        syncState = SYNC_IDLE;
        syncFile = nullptr;
        if (!connected) {
            syncManifestBuilt = false; // Ids are connection-scoped
        }
    }

    // Deferred clock set (may rename unsynced files on the card).
    if (timeSyncPending) {
        timeSyncPending = false;
        storage_set_time(timeSyncValue);
        updateSyncStatus(true); // Clock-valid flag changed
    }

    // Delete-all: wipe the backlog by reformatting the card (storage_format),
    // which is O(1) regardless of file count and resets FAT directory bloat.
    // SYNC_FLAG_PURGING is announced before and cleared after so the app detects
    // start and completion from the notify stream.
    if (syncPurgeRequested) {
        syncPurgeRequested = false;
        syncState = SYNC_IDLE;
        syncFile = nullptr;
        syncManifestBuilt = false;
        syncPurgeActive = true;
        updateSyncStatus(true); // announce purging=true (count still full)
        bool ok = storage_format();
        syncPurgeActive = false;
        updateSyncStatus(true); // purging=false + fresh (zero) counts = completion signal
        Serial.printf("sync: purge (format) %s\n", ok ? "complete" : "FAILED");
    }

    if (!connected || syncDataCharacteristic == nullptr) {
        return;
    }

    // Deletions for files the app verified. Throttled implicitly by the queue
    // depth; each delete is a single FAT operation.
    bool ackedAny = false;
    while (syncAckTail != syncAckHead) {
        uint32_t id = syncAckQueue[syncAckTail];
        syncAckTail = (syncAckTail + 1) % 8;
        manifest_entry_t *entry = findManifestEntry(id);
        if (entry != nullptr && entry->path[0] != '\0') {
            storage_delete_file(entry->path, entry->type, entry->size);
            entry->path[0] = '\0'; // Guard against double-ack
            ackedAny = true;
            SYNC_LOG("file %lu acked -> deleted from SD", (unsigned long) id);
        } else {
            SYNC_LOG("file %lu ack ignored (unknown/already deleted)", (unsigned long) id);
        }
    }
    // When a sync drains a directory to empty, reset its FAT table so long-lived
    // always-synced devices don't accumulate directory bloat (no-op if non-empty).
    if (ackedAny) {
        storage_compact_empty_dirs();
    }

    if (syncManifestRequested) {
        syncManifestRequested = false;
        if (syncManifest == nullptr) {
            syncManifest = (manifest_entry_t *) ps_malloc(SYNC_MANIFEST_MAX_ENTRIES * sizeof(manifest_entry_t));
        }
        if (syncManifest != nullptr) {
            syncManifestCount = storage_build_manifest(syncManifest, SYNC_MANIFEST_MAX_ENTRIES);
            syncManifestBuilt = true;
            syncManifestSendIndex = 0;
            syncState = SYNC_SENDING_MANIFEST;
            SYNC_LOG("manifest built (%d entries)", syncManifestCount);
        } else {
            SYNC_LOG("manifest alloc FAILED (ps_malloc returned null)");
        }
    }

    if (syncFileRequested) {
        syncFileRequested = false;
        manifest_entry_t *entry = findManifestEntry(syncRequestedFileId);
        if (entry == nullptr || entry->path[0] == '\0') {
            SYNC_LOG("file %lu -> ERROR (not in manifest / already deleted)", (unsigned long) syncRequestedFileId);
            syncSendFileError(syncRequestedFileId);
        } else if (syncRequestedOffset > entry->size) {
            // App claims more bytes than the file holds (stale partial after the
            // file changed): refuse so it discards its buffer and refetches from 0.
            SYNC_LOG("file %lu -> ERROR (offset %lu > size %lu)",
                     (unsigned long) syncRequestedFileId,
                     (unsigned long) syncRequestedOffset,
                     (unsigned long) entry->size);
            syncSendFileError(syncRequestedFileId);
        } else {
            SYNC_LOG("file %lu start (offset=%lu/%lu type=%u)",
                     (unsigned long) entry->id,
                     (unsigned long) syncRequestedOffset,
                     (unsigned long) entry->size,
                     entry->type);
            syncFile = entry;
            // Resume from the app's offset, seeding the running CRC with the app's
            // CRC over the bytes it already has. seq always restarts at 0 for the
            // request, so the app appends this stream onto its held prefix.
            syncFileOffset = syncRequestedOffset;
            syncFileSeq = 0;
            syncFileCrc = syncRequestedCrc;
            syncFileCongestion = 0;
            syncState = SYNC_SENDING_FILE;
        }
    }

    if (syncState == SYNC_SENDING_MANIFEST) {
        size_t maxValue = syncMaxValue();
        int perPacket = (int) ((maxValue - 2) / SYNC_MANIFEST_ENTRY_BYTES);
        if (perPacket > 255) {
            perPacket = 255;
        }
        for (int burst = 0; burst < SYNC_CHUNKS_PER_LOOP && syncState == SYNC_SENDING_MANIFEST; burst++) {
            if (syncManifestSendIndex >= syncManifestCount) {
                syncTxBuffer[0] = SYNC_PKT_MANIFEST_END;
                uint16_t count = (uint16_t) syncManifestCount;
                memcpy(&syncTxBuffer[1], &count, 2);
                if (!syncNotify(3)) {
                    delay(SYNC_CONGESTION_BACKOFF_MS); // resend MANIFEST_END next pass
                    break;
                }
                SYNC_LOG("manifest sent (%d entries) -> MANIFEST_END", syncManifestCount);
                syncState = SYNC_IDLE;
                break;
            }
            int n = syncManifestCount - syncManifestSendIndex;
            if (n > perPacket) {
                n = perPacket;
            }
            syncTxBuffer[0] = SYNC_PKT_MANIFEST;
            syncTxBuffer[1] = (uint8_t) n;
            size_t pos = 2;
            for (int i = 0; i < n; i++) {
                manifest_entry_t *e = &syncManifest[syncManifestSendIndex + i];
                memcpy(&syncTxBuffer[pos], &e->id, 4);
                syncTxBuffer[pos + 4] = e->type;
                memcpy(&syncTxBuffer[pos + 5], &e->size, 4);
                memcpy(&syncTxBuffer[pos + 9], &e->epochMs, 8);
                syncTxBuffer[pos + 17] = e->orientation;
                pos += SYNC_MANIFEST_ENTRY_BYTES;
            }
            if (!syncNotify(pos)) {
                delay(SYNC_CONGESTION_BACKOFF_MS); // dropped: resend this batch (index not advanced)
                break;
            }
            syncManifestSendIndex += n;
            delay(SYNC_CHUNK_DELAY_MS);
        }
        return;
    }

    if (syncState == SYNC_SENDING_FILE && syncFile != nullptr) {
        size_t payloadMax = syncMaxValue() - 7; // [type][u32 id][u16 seq]
        for (int burst = 0; burst < SYNC_CHUNKS_PER_LOOP && syncState == SYNC_SENDING_FILE; burst++) {
            if (syncFileOffset >= syncFile->size) {
                syncTxBuffer[0] = SYNC_PKT_FILE_END;
                memcpy(&syncTxBuffer[1], &syncFile->id, 4);
                memcpy(&syncTxBuffer[5], &syncFileCrc, 4);
                if (!syncNotify(9)) {
                    syncFileCongestion++;
                    delay(SYNC_CONGESTION_BACKOFF_MS); // resend FILE_END next pass
                    break;
                }
                SYNC_LOG("file %lu sent (%lu bytes, crc=%08lx, %lu congestion backoffs)",
                         (unsigned long) syncFile->id,
                         (unsigned long) syncFile->size,
                         (unsigned long) syncFileCrc,
                         (unsigned long) syncFileCongestion);
                syncFile = nullptr;
                syncState = SYNC_IDLE;
                break;
            }
            int n = storage_read_file(syncFile->path, syncFileOffset, &syncTxBuffer[7], payloadMax);
            if (n <= 0) {
                SYNC_LOG("file %lu -> ERROR (SD read failed at offset %lu, n=%d)",
                         (unsigned long) syncFile->id,
                         (unsigned long) syncFileOffset,
                         n);
                syncSendFileError(syncFile->id);
                syncFile = nullptr;
                syncState = SYNC_IDLE;
                break;
            }
            syncTxBuffer[0] = SYNC_PKT_CHUNK;
            memcpy(&syncTxBuffer[1], &syncFile->id, 4);
            memcpy(&syncTxBuffer[5], &syncFileSeq, 2);
            if (!syncNotify(7 + n)) {
                // Dropped by a full TX buffer: leave offset/seq/CRC untouched so
                // the same chunk re-reads and resends next pass (no data loss).
                syncFileCongestion++;
                delay(SYNC_CONGESTION_BACKOFF_MS);
                break;
            }
            syncFileCrc = esp_rom_crc32_le(syncFileCrc, &syncTxBuffer[7], n);
            syncFileOffset += n;
            syncFileSeq++;
            delay(SYNC_CHUNK_DELAY_MS);
        }
    }
}

// -------------------------------------------------------------------------
// configure_ble()
// -------------------------------------------------------------------------
void configure_ble()
{
    Serial.println("Initializing BLE...");
    BLEDevice::init(BLE_DEVICE_NAME);
    // Offer a large MTU so the audio TX can batch several Opus frames per
    // notification (the client also requests this MTU on connect).
    BLEDevice::setMTU(BLE_MTU_SIZE);
    BLEServer *server = BLEDevice::createServer();
    server->setCallbacks(new ServerHandler());

    // Main service. The default numHandles (15) is far too small for this
    // service: 10 characteristics + 5 CCCD descriptors + the service entry
    // need 26 handles, so without an explicit count the later characteristics
    // (sync status/control/data, time sync, mode control) silently fail to
    // register and the app sees "Characteristic not found". Pad for headroom.
    BLEService *service = server->createService(serviceUUID, 40);

    // Audio Data characteristic (for streaming audio to app)
    audioDataCharacteristic = service->createCharacteristic(
        audioDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    audioDataCharacteristic->setCallbacks(new AudioDataCallback());

    // Audio Codec characteristic (tells app which codec we're using)
    audioCodecCharacteristic = service->createCharacteristic(audioCodecUUID, BLECharacteristic::PROPERTY_READ);
    uint8_t codecId = opus_get_codec_id();
    audioCodecCharacteristic->setValue(&codecId, 1);

    // Photo Data characteristic
    photoDataCharacteristic = service->createCharacteristic(
        photoDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);

    // Photo Control characteristic
    photoControlCharacteristic = service->createCharacteristic(photoControlUUID, BLECharacteristic::PROPERTY_WRITE);
    photoControlCharacteristic->setCallbacks(new PhotoControlCallback());
    uint8_t controlValue = 0;
    photoControlCharacteristic->setValue(&controlValue, 1);

    // Power Control characteristic (sleep / reboot commands from the app)
    powerControlCharacteristic = service->createCharacteristic(powerControlUUID, BLECharacteristic::PROPERTY_WRITE);
    powerControlCharacteristic->setCallbacks(new PowerControlCallback());

    // Sync Status characteristic (unsynced file counts + flags)
    syncStatusCharacteristic = service->createCharacteristic(
        syncStatusUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);

    // Sync Control characteristic (manifest / file requests, acks, abort)
    syncControlCharacteristic = service->createCharacteristic(syncControlUUID, BLECharacteristic::PROPERTY_WRITE);
    syncControlCharacteristic->setCallbacks(new SyncControlCallback());

    // Sync Data characteristic (manifest entries + file chunks)
    syncDataCharacteristic = service->createCharacteristic(
        syncDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    syncDataCharacteristic->setCallbacks(new SyncDataStatusCallback());

    // Time Sync characteristic (the app writes epoch ms on every connect)
    timeSyncCharacteristic = service->createCharacteristic(timeSyncUUID, BLECharacteristic::PROPERTY_WRITE);
    timeSyncCharacteristic->setCallbacks(new TimeSyncCallback());

    // Capture Mode characteristic (LOCAL / STREAMING switch from the app).
    // The real initial value is published in setup_app once the SD state is
    // known (configure_ble runs before storage_init).
    modeControlCharacteristic = service->createCharacteristic(
        modeControlUUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
    modeControlCharacteristic->setCallbacks(new ModeControlCallback());
    uint8_t initialMode = captureMode;
    modeControlCharacteristic->setValue(&initialMode, 1);

    updateSyncStatus(false);

    // Device Information Service
    BLEService *deviceInfoService = server->createService(DEVICE_INFORMATION_SERVICE_UUID);
    BLECharacteristic *manufacturerNameCharacteristic =
        deviceInfoService->createCharacteristic(MANUFACTURER_NAME_STRING_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
    BLECharacteristic *modelNumberCharacteristic =
        deviceInfoService->createCharacteristic(MODEL_NUMBER_STRING_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
    BLECharacteristic *firmwareRevisionCharacteristic =
        deviceInfoService->createCharacteristic(FIRMWARE_REVISION_STRING_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
    BLECharacteristic *hardwareRevisionCharacteristic =
        deviceInfoService->createCharacteristic(HARDWARE_REVISION_STRING_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
    BLECharacteristic *serialNumberCharacteristic =
        deviceInfoService->createCharacteristic(SERIAL_NUMBER_STRING_CHAR_UUID, BLECharacteristic::PROPERTY_READ);

    manufacturerNameCharacteristic->setValue(MANUFACTURER_NAME);
    modelNumberCharacteristic->setValue(BLE_DEVICE_NAME);
    firmwareRevisionCharacteristic->setValue(FIRMWARE_VERSION_STRING);
    hardwareRevisionCharacteristic->setValue(HARDWARE_REVISION);

    // Generate serial number from ESP32 chip ID
    uint64_t chipId = ESP.getEfuseMac();
    char serialNumber[17];
    snprintf(serialNumber, sizeof(serialNumber), "%04X%08X", (uint16_t) (chipId >> 32), (uint32_t) chipId);
    serialNumberCharacteristic->setValue(serialNumber);

    // OTA Service
    BLEService *otaService = server->createService(otaServiceUUID);

    // OTA Control characteristic (for receiving commands and reading status)
    otaControlCharacteristic = otaService->createCharacteristic(
        otaControlUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
    // The OTA control callback lives in ota.cpp and is attached by
    // ota_set_characteristics() below (single definition, avoids an ODR clash).

    // OTA Data characteristic (for progress notifications)
    otaDataCharacteristic = otaService->createCharacteristic(
        otaDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);

    // Set OTA characteristics for the OTA module
    ota_set_characteristics(otaControlCharacteristic, otaDataCharacteristic);

    // Start services
    service->start();
    deviceInfoService->start();
    otaService->start();

    // Start advertising
    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(service->getUUID()); // Main service (fits in 31 bytes)
    advertising->setScanResponse(true);
    advertising->setMinPreferred(BLE_ADV_MIN_INTERVAL);
    advertising->setMaxPreferred(BLE_ADV_MAX_INTERVAL);
    BLEDevice::startAdvertising();

    Serial.println("BLE initialized and advertising started.");
}

// -------------------------------------------------------------------------
// Camera
// -------------------------------------------------------------------------
bool take_photo()
{
    // Release previous buffer
    if (fb) {
        Serial.println("Releasing previous camera buffer...");
        esp_camera_fb_return(fb);
        fb = nullptr;
    }

    Serial.println("Capturing photo...");
    fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("Failed to get camera frame buffer!");
        return false;
    }
    Serial.print("Photo captured: ");
    Serial.print(fb->len);
    Serial.println(" bytes.");

    // Set fixed orientation for the captured photo
    current_photo_orientation = FIXED_IMAGE_ORIENTATION;
    Serial.println("Photo orientation set to 180 degrees (fixed).");

    return true;
}

void handlePhotoControl(int8_t controlValue)
{
    if (controlValue == -1) {
        Serial.println("Received command: Single photo.");
        isCapturingPhotos = true;
        captureInterval = 0;
    } else if (controlValue == 0) {
        Serial.println("Received command: Stop photo capture.");
        isCapturingPhotos = false;
        captureInterval = 0;
    } else if (controlValue >= 5 && controlValue <= 300) {
        Serial.print("Received command: Start interval capture with parameter ");
        Serial.println(controlValue);

        // Use fixed interval from config for optimal battery life
        captureInterval = PHOTO_CAPTURE_INTERVAL_MS;
        Serial.print("Using configured interval: ");
        Serial.print(captureInterval / 1000);
        Serial.println(" seconds");

        isCapturingPhotos = true;
        lastCaptureTime = millis() - captureInterval;
    }
}

// -------------------------------------------------------------------------
// configure_camera()
// -------------------------------------------------------------------------
void configure_camera()
{
    Serial.println("Initializing camera...");
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;
    config.pin_d0 = Y2_GPIO_NUM;
    config.pin_d1 = Y3_GPIO_NUM;
    config.pin_d2 = Y4_GPIO_NUM;
    config.pin_d3 = Y5_GPIO_NUM;
    config.pin_d4 = Y6_GPIO_NUM;
    config.pin_d5 = Y7_GPIO_NUM;
    config.pin_d6 = Y8_GPIO_NUM;
    config.pin_d7 = Y9_GPIO_NUM;
    config.pin_xclk = XCLK_GPIO_NUM;
    config.pin_pclk = PCLK_GPIO_NUM;
    config.pin_vsync = VSYNC_GPIO_NUM;
    config.pin_href = HREF_GPIO_NUM;
    config.pin_sscb_sda = SIOD_GPIO_NUM;
    config.pin_sscb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn = PWDN_GPIO_NUM;
    config.pin_reset = RESET_GPIO_NUM;
    config.xclk_freq_hz = CAMERA_XCLK_FREQ;

    // Use config.h camera settings optimized for battery life
    config.frame_size = CAMERA_FRAME_SIZE;
    config.pixel_format = PIXFORMAT_JPEG;
    config.fb_count = 2; // double-buffer for steadier capture at higher resolution
    config.jpeg_quality = CAMERA_JPEG_QUALITY;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("Camera init failed with error 0x%x\n", err);
    } else {
        cameraActive = true;
        Serial.println("Camera initialized successfully.");
    }
}

// Bring the camera up on demand (it is kept deinitialized between captures to
// save power -- see CAMERA_WARMUP_FRAMES in config.h). Discards a few warm-up
// frames so exposure has settled before the caller grabs the kept shot.
// Returns false if init failed. Blocks core0 for the init + warm-up duration,
// so callers must gate this the same way take_photo() is (skipped during sync).
static bool camera_ensure_on()
{
    if (cameraActive) {
        return true;
    }
    configure_camera();
    if (!cameraActive) {
        return false;
    }
    for (int i = 0; i < CAMERA_WARMUP_FRAMES; i++) {
        camera_fb_t *warm = esp_camera_fb_get();
        if (warm) {
            esp_camera_fb_return(warm);
        }
    }
    return true;
}

// Power the camera back down between captures. Safe to call when already off.
// The caller must have returned any held frame buffer first (esp_camera_deinit
// frees the framebuffer pool underneath it).
static void camera_off()
{
    if (!cameraActive) {
        return;
    }
    esp_camera_deinit();
    cameraActive = false;
}

// -------------------------------------------------------------------------
// Setup & Loop
// -------------------------------------------------------------------------

// A small buffer for sending photo chunks over BLE
static uint8_t *s_compressed_frame_2 = nullptr;

void setup_app()
{
    Serial.begin(921600);
    Serial.println("Setup started...");

    // Initialize GPIO
    pinMode(POWER_BUTTON_PIN, INPUT_PULLUP);
    pinMode(STATUS_LED_PIN, OUTPUT);

    // LED uses inverted logic: HIGH = OFF, LOW = ON
    digitalWrite(STATUS_LED_PIN, HIGH);

    // Setup button interrupt
    attachInterrupt(digitalPinToInterrupt(POWER_BUTTON_PIN), buttonISR, CHANGE);

    // Calibrate the copper-foil touch sensor
    setupTouch();

    // Boot blink runs synchronously here because the LED pin doubles as the
    // SD chip select: once storage_init() mounts the card the LED is hands-off
    // (updateLED no-ops), so the async LED_BOOT_SEQUENCE would never show.
    blinkLED(3, 150);
    digitalWrite(STATUS_LED_PIN, HIGH); // Leave the pin deselected for the SD card
    ledMode = LED_NORMAL_OPERATION;

    // Fixed CPU frequency from config.h (mic clock requires >= 80MHz)
    setCpuFrequencyMhz(NORMAL_CPU_FREQ_MHZ);

    configure_ble();
    // Probe the camera at boot to surface wiring/PSRAM faults early, then power
    // it back down. It is brought up on demand for each interval capture
    // (camera_ensure_on) and kept off the rest of the time to save battery.
    configure_camera();
    camera_off();

    // Mount the microSD card. With a card present the device records photos
    // and VAD-gated audio to it continuously and the app pulls them via the
    // sync protocol; without one it falls back to legacy live streaming.
    storage_init();

    // Allocate buffer for photo chunks (200 bytes + 2 for frame index)
    s_compressed_frame_2 = (uint8_t *) ps_calloc(BLE_CHUNK_SIZE + 2, sizeof(uint8_t));
    if (!s_compressed_frame_2) {
        Serial.println("Failed to allocate chunk buffer!");
    } else {
        Serial.println("Chunk buffer allocated successfully.");
    }

    // Restore the persisted capture mode now that the SD state is known. The
    // first boot (nothing persisted) defaults to LOCAL when a card is present,
    // matching the previous SD-first behavior, and STREAMING otherwise.
    uint8_t savedMode = loadPersistedMode();
    if (savedMode != CAPTURE_MODE_LOCAL && savedMode != CAPTURE_MODE_STREAMING) {
        savedMode = storage_available() ? CAPTURE_MODE_LOCAL : CAPTURE_MODE_STREAMING;
    }
    applyCaptureMode(savedMode);
    lastCaptureTime = millis() - captureInterval;
    Serial.print("Default capture interval set to ");
    Serial.print(PHOTO_CAPTURE_INTERVAL_MS / 1000);
    Serial.println(" seconds.");

    deviceState = DEVICE_ACTIVE;

    // Initialize audio subsystem
    Serial.println("Initializing audio subsystem...");
    if (opus_encoder_init() && vad_init()) {
        opus_set_callback(onOpusEncoded);
        vad_set_pcm_callback(onVoicedPcm);
        vad_set_state_callback(onVadStateChange);

        if (mic_start()) {
            mic_set_callback(onMicData);
            // 音声処理を専用タスクへ(16KB スタック, core1)。優先度は 2 に抑え、
            // audioTask 内で毎周回 yield することで loopTask/割り込みを飢餓させない。
            xTaskCreatePinnedToCore(audioTask, "audio", 16384, NULL, 2, &audioTaskHandle, 1);
            Serial.println("Audio subsystem initialized successfully.");
        } else {
            Serial.println("Failed to start microphone!");
        }
    } else {
        Serial.println("Failed to initialize Opus encoder!");
    }

    Serial.println("Setup complete.");
}

void loop_app()
{
    unsigned long now = millis();

    // Handle button presses
    handleButton();

    // Handle copper-foil touch (hold to power off)
    handleTouch();

    // Handle BLE power commands (deferred from PowerControlCallback)
    if (rebootRequested) {
        Serial.println("Rebooting by BLE command...");
        delay(200); // Let the BLE write response flush
        ESP.restart();
    }
    if (powerOffRequested) {
        powerOffRequested = false;
        if (ledMode != LED_POWER_OFF_SEQUENCE) {
            Serial.println("Sleep requested by BLE command");
            ledMode = LED_POWER_OFF_SEQUENCE;
        }
    }

    // Update LED
    updateLED();

    // One-shot wakeup cause log, delayed so the USB CDC host can re-attach first
    static bool wakeCauseLogged = false;
    if (!wakeCauseLogged && now > 8000) {
        Serial.printf("Wakeup cause: %d (0=power-on 3=button 4=timer 5=touch)\n", (int) esp_sleep_get_wakeup_cause());
        wakeCauseLogged = true;
    }

#if TOUCH_DEBUG_LOG
    // Debug: LED mirrors the touch state so the threshold can be tuned without
    // a serial connection (LED is inverted: LOW = ON)
    if (touchDebugLed && ledMode == LED_NORMAL_OPERATION) {
        digitalWrite(STATUS_LED_PIN, LOW);
    }
#endif

    // Apply a capture-mode write (deferred from ModeControlCallback). The raw
    // request is persisted as the user's intent; applyCaptureMode resolves it
    // against SD availability and notifies the effective mode back.
    if (modeChangeRequested) {
        modeChangeRequested = false;
        uint8_t mode = requestedMode;
        if (mode == CAPTURE_MODE_LOCAL || mode == CAPTURE_MODE_STREAMING) {
            persistMode(mode);
            applyCaptureMode(mode);
        }
    }

    // Process OTA updates
    ota_loop();

    // Sync transfer (manifest / file chunks / acks / deferred time set)
    processSync();

#if SYNC_PAUSE_CAPTURE
    // Dedicate the device to an active sync: pause audio capture (and, with it,
    // the PDM mic) so the transfer owns the SD bus and CPU. With the mic stopped
    // we can also raise the CPU clock — applied only once audioTask confirms the
    // mic is halted, and dropped back to NORMAL before the mic is restarted.
    {
        static bool syncCapturePaused = false;
        bool active = syncSessionActive();
        if (active && !syncCapturePaused) {
            utteranceEndPending = true; // flush+close any open utterance on audioTask's next pass
            audioPauseRequested = true;
            syncCapturePaused = true;
            SYNC_LOG("session active -> capture paused");
        } else if (!active && syncCapturePaused) {
#if SYNC_BOOST_CPU_MHZ
            setCpuFrequencyMhz(NORMAL_CPU_FREQ_MHZ); // restore before the mic restarts (PDM needs the normal clock)
#endif
            audioPauseRequested = false;
            syncCapturePaused = false;
            SYNC_LOG("session idle (%lu ms quiet) -> capture resumed", (unsigned long) SYNC_ACTIVE_IDLE_MS);
        }
#if SYNC_BOOST_CPU_MHZ
        // Raise the clock only after the mic is confirmed stopped, and only once.
        static bool cpuBoosted = false;
        if (syncCapturePaused && audioPaused && !cpuBoosted) {
            setCpuFrequencyMhz(SYNC_BOOST_CPU_MHZ);
            cpuBoosted = true;
            SYNC_LOG("CPU boosted to %d MHz (mic confirmed stopped)", SYNC_BOOST_CPU_MHZ);
        } else if (!syncCapturePaused && cpuBoosted) {
            cpuBoosted = false; // clock already restored above, before clearing the pause request
        }
#endif
    }
#endif

    // Notify the app when the unsynced counts change (throttled; the app also
    // reads SYNC_STATUS on connect).
    static unsigned long lastSyncStatusUpdate = 0;
    static uint32_t lastSyncStatusFingerprint = 0;
    if (now - lastSyncStatusUpdate >= SYNC_STATUS_INTERVAL_MS) {
        uint16_t audioCount = 0;
        uint16_t photoCount = 0;
        uint32_t totalBytes = 0;
        storage_stats(&audioCount, &photoCount, &totalBytes);
        uint32_t fingerprint = ((uint32_t) audioCount << 16) ^ photoCount ^ totalBytes;
        if (fingerprint != lastSyncStatusFingerprint) {
            updateSyncStatus(true);
            lastSyncStatusFingerprint = fingerprint;
        }
        lastSyncStatusUpdate = now;
    }

    // 音声のキャプチャ/エンコード/送信はすべて audioTask(専用タスク)で実行する。
    // ここ(loopTask)で送ると写真送信などでループが詰まる間に TX リングが溢れて
    // 音声フレームを落とすため、producer と同じタスク内で送るようにした。

    // Check if it's time to capture a photo, by mode:
    //   LOCAL                    -> save to the SD on the fixed interval,
    //                               connection-independent (live upload only on
    //                               an explicit PHOTO_CONTROL request)
    //   STREAMING + connected    -> live upload only (isCapturingPhotos, set by
    //                               the mode switch / PHOTO_CONTROL)
    //   STREAMING + disconnected -> fall back to the SD so the time out of
    //                               range is still captured (synced later)
    bool singleShot = isCapturingPhotos && captureInterval == 0;
    bool photoDue = singleShot || (now - lastCaptureTime >= (unsigned long) captureInterval);
    bool sdSave = storage_available() && (captureMode == CAPTURE_MODE_LOCAL || !connected);
    bool wantLiveUpload = isCapturingPhotos && connected;
    bool wantPhoto = sdSave || wantLiveUpload;
    // Skip interval capture during an active sync: take_photo() blocks core0 for
    // ~50-100ms and would stall the transfer (the missed frame is captured once
    // the session goes idle).
    if (wantPhoto && !photoDataUploading && photoDue && !syncCaptureSuspended()) {
        if (singleShot) {
            isCapturingPhotos = false;
            if (storage_available()) {
                captureInterval = PHOTO_CAPTURE_INTERVAL_MS; // resume interval capture to SD
            }
        }
        Serial.println("Interval reached. Capturing photo...");
        // Bring the camera up just for this shot; it is kept off between
        // intervals to save power. camera_ensure_on() blocks for the init +
        // warm-up, but we already skip this whole block during a sync.
        if (!camera_ensure_on()) {
            Serial.println("Camera unavailable; skipping capture.");
        } else if (take_photo()) {
            lastCaptureTime = now;
            if (sdSave) {
                storage_save_photo(fb->buf, fb->len, (uint8_t) current_photo_orientation);
            }
            if (wantLiveUpload) {
                // Keep the camera on until the BLE upload finishes returning the
                // frame buffer (deinit would free it underneath the transfer);
                // camera_off() runs at the end-of-photo marker below.
                Serial.println("Photo capture successful. Starting upload...");
                photoDataUploading = true;
                sent_photo_bytes = 0;
                sent_photo_frames = 0;
            } else {
                esp_camera_fb_return(fb);
                fb = nullptr;
                camera_off();
            }
        } else {
            // Grab failed after a successful init -- don't strand the camera on.
            camera_off();
        }
    }

    // If uploading, send chunks over BLE (interleave with audio - max 4 chunks per loop)
    static int photo_chunks_this_loop = 0;
    if (photoDataUploading && fb && photo_chunks_this_loop < 4) {
        // Yield to audio if audio buffer has data
        if (audioSubscribed && audio_tx_read_pos != audio_tx_write_pos) {
            photo_chunks_this_loop = 0; // Reset for next loop
        } else {
            photo_chunks_this_loop++;
        }
        size_t remaining = fb->len - sent_photo_bytes;
        if (remaining > 0) {
            size_t bytes_to_copy;
            if (sent_photo_frames == 0) {
                // First chunk: includes orientation metadata
                s_compressed_frame_2[0] = 0; // Frame index low byte
                s_compressed_frame_2[1] = 0; // Frame index high byte
                s_compressed_frame_2[2] = (uint8_t) current_photo_orientation;
                bytes_to_copy = (remaining > BLE_CHUNK_SIZE - 1) ? BLE_CHUNK_SIZE - 1 : remaining;
                memcpy(&s_compressed_frame_2[3], &fb->buf[sent_photo_bytes], bytes_to_copy);
                photoDataCharacteristic->setValue(s_compressed_frame_2, bytes_to_copy + 3);
            } else {
                // Subsequent chunks
                s_compressed_frame_2[0] = (uint8_t) (sent_photo_frames & 0xFF);
                s_compressed_frame_2[1] = (uint8_t) ((sent_photo_frames >> 8) & 0xFF);
                bytes_to_copy = (remaining > BLE_CHUNK_SIZE) ? BLE_CHUNK_SIZE : remaining;
                memcpy(&s_compressed_frame_2[2], &fb->buf[sent_photo_bytes], bytes_to_copy);
                photoDataCharacteristic->setValue(s_compressed_frame_2, bytes_to_copy + 2);
            }
            photoDataCharacteristic->notify();

            sent_photo_bytes += bytes_to_copy;
            sent_photo_frames++;

            Serial.print("Uploading chunk ");
            Serial.print(sent_photo_frames);
            Serial.print(" (");
            Serial.print(bytes_to_copy);
            Serial.print(" bytes), ");
            Serial.print(remaining - bytes_to_copy);
            Serial.println(" bytes remaining.");
        } else {
            // End of photo marker
            s_compressed_frame_2[0] = 0xFF;
            s_compressed_frame_2[1] = 0xFF;
            photoDataCharacteristic->setValue(s_compressed_frame_2, 2);
            photoDataCharacteristic->notify();
            Serial.println("Photo upload complete.");

            photoDataUploading = false;
            // Free camera buffer, then power the camera down until the next
            // interval (the buffer must be returned before deinit frees the pool).
            esp_camera_fb_return(fb);
            fb = nullptr;
            camera_off();
            Serial.println("Camera frame buffer freed.");
            photo_chunks_this_loop = 0; // Reset counter
        }
    } else {
        photo_chunks_this_loop = 0; // Reset when not uploading
    }

    // Adaptive loop delay: flat-out during a sync, fast while streaming, relaxed
    // otherwise. Without the sync case the loop used to sleep 50ms after every
    // chunk burst (audio/photo streaming are not subscribed during a pull), which
    // dominated transfer time; yield minimally so the next burst starts at once.
    if (syncSessionActive()) {
        delay(0);
    } else if (photoDataUploading || audioSubscribed) {
        delay(5); // Fast during upload or audio streaming
    } else {
        delay(50);
    }
}
