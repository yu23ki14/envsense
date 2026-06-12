#include "app.h"

#include <BLE2902.h>
#include <BLEAdvertisedDevice.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEUtils.h>

#include "config.h" // Use config.h for all configurations
#include "driver/rtc_io.h"
#include "esp_rom_crc.h"
#include "esp_camera.h"
#include "esp_sleep.h"
#include "mic.h"
#include "opus_encoder.h"
#include "ota.h"
#include "storage.h"
#include "vad.h"

// Battery state
float batteryVoltage = 0.0f;
int batteryPercentage = 0;
unsigned long lastBatteryCheck = 0;

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

// Gentle power optimization
unsigned long lastActivity = 0;
bool powerSaveMode = false;

// Light sleep optimization - saves ~15mA = adds 3-4 hours battery life
bool lightSleepEnabled = true;

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

// OTA Service UUIDs
static BLEUUID otaServiceUUID(OTA_SERVICE_UUID);
static BLEUUID otaControlUUID(OTA_CONTROL_UUID);
static BLEUUID otaDataUUID(OTA_DATA_UUID);

// Characteristics
BLECharacteristic *photoDataCharacteristic;
BLECharacteristic *photoControlCharacteristic;
BLECharacteristic *powerControlCharacteristic;
BLECharacteristic *batteryLevelCharacteristic;
BLECharacteristic *audioDataCharacteristic;
BLECharacteristic *audioCodecCharacteristic;
BLECharacteristic *otaControlCharacteristic;
BLECharacteristic *otaDataCharacteristic;
BLECharacteristic *syncStatusCharacteristic;
BLECharacteristic *syncControlCharacteristic;
BLECharacteristic *syncDataCharacteristic;
BLECharacteristic *timeSyncCharacteristic;

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
static volatile bool syncAbortRequested = false;
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
static uint8_t syncTxBuffer[BLE_MTU_SIZE];

// -------------------------------------------------------------------------
// Camera Frame
// -------------------------------------------------------------------------
camera_fb_t *fb = nullptr;
image_orientation_t current_photo_orientation = ORIENTATION_0_DEGREES;

// Forward declarations
void handlePhotoControl(int8_t controlValue);
void readBatteryLevel();
void updateBatteryService();
void IRAM_ATTR buttonISR();
void handleButton();
void setupTouch();
void handleTouch();
void updateLED();
void blinkLED(int count, int delayMs);
void enterPowerSave();
void exitPowerSave();
void shutdownDevice();
void enableLightSleep();

// Audio forward declarations
void onMicData(int16_t *data, size_t samples);
void onOpusEncoded(uint8_t *data, size_t len);
void processAudioTx();

// Sync forward declarations
void updateSyncStatus(bool notifyApp);
void processSync(unsigned long now);

// -------------------------------------------------------------------------
// Button ISR
// -------------------------------------------------------------------------
void IRAM_ATTR buttonISR()
{
    buttonPressed = true;
}

// Touch interrupt only exists to wake the chip out of light sleep so the main
// loop can resume polling the foil; the handler itself has nothing to do.
void IRAM_ATTR touchWakeISR() {}

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
        unsigned long pressDuration = now - buttonPressTime;
        lastDebounceTime = now;

        // Only handle short press if long press wasn't already triggered
        if (!longPressTriggered && pressDuration >= 50) {
            // Short press - register activity
            lastActivity = now;
            if (powerSaveMode) {
                exitPowerSave();
            }
        }
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

// Median of TOUCH_FILTER_SAMPLES raw reads; on battery power single samples
// spike too much (camera / BLE load on the supply rail) to act on directly.
static uint32_t touchReadFiltered()
{
    uint32_t s[TOUCH_FILTER_SAMPLES];
    for (int i = 0; i < TOUCH_FILTER_SAMPLES; i++) {
        s[i] = touchRead(TOUCH_SENSE_PIN);
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
    // Longer charge integration than the default for a better SNR; required
    // for the low thresholds that battery-powered (floating-ground) touch needs
    touchSetCycles(TOUCH_MEASURE_CYCLES, TOUCH_SLEEP_CYCLES);

    if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TOUCHPAD && touchBaseline > 0) {
        // Woken by the foil: keep the baseline stored in RTC memory and ignore
        // the touch still in progress so we don't immediately power off again.
        touchWaitRelease = true;
    } else {
        // Cold boot or button wake: calibrate assuming the foil is untouched.
        for (int i = 0; i < 4; i++) {
            touchRead(TOUCH_SENSE_PIN); // Discard warm-up readings
        }
        uint64_t sum = 0;
        for (int i = 0; i < TOUCH_BASELINE_SAMPLES; i++) {
            sum += touchRead(TOUCH_SENSE_PIN);
            delay(10);
        }
        touchBaseline = (uint32_t) (sum / TOUCH_BASELINE_SAMPLES);
    }
    Serial.printf("Touch baseline: %lu, on/off thresholds: %lu / %lu\n", (unsigned long) touchBaseline,
                  (unsigned long) touchOnThreshold(), (unsigned long) touchOffThreshold());

    // Arm touch wake-up for light sleep: while BLE-connected the main loop can
    // sit in esp_light_sleep_start() for up to 15s and would never poll the
    // foil. A touch wakes the loop, which then times the 2s hold as usual.
    touchAttachInterrupt(TOUCH_SENSE_PIN, touchWakeISR, (uint32_t) (touchBaseline * TOUCH_TOUCH_RATIO));
    esp_sleep_enable_touchpad_wakeup();
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
        Serial.printf("Touch filtered: %lu baseline: %lu (on: %lu / off: %lu)\n", (unsigned long) filtered,
                      (unsigned long) touchBaseline, (unsigned long) touchOnThreshold(),
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
void enterPowerSave()
{
    if (!powerSaveMode) {
        // Below 80MHz the PLL powers down and takes the I2S/PDM mic clock
        // with it, so the 40MHz floor is only allowed when the mic is off.
        // With always-on VAD capture the savings come from skipping the Opus
        // encode + SD writes during silence, not from the CPU clock.
        if (!mic_is_running()) {
            setCpuFrequencyMhz(MIN_CPU_FREQ_MHZ); // 40MHz for idle
        }
        powerSaveMode = true;
    }
}

void exitPowerSave()
{
    if (powerSaveMode) {
        setCpuFrequencyMhz(NORMAL_CPU_FREQ_MHZ); // Back to 80MHz
        powerSaveMode = false;
    }
}

void enableLightSleep()
{
    // Light sleep gates the I2S DMA clock, so it is incompatible with the
    // always-on VAD capture; it only ever fires when the mic is stopped.
    if (!lightSleepEnabled || !connected || photoDataUploading || mic_is_running() || syncState != SYNC_IDLE) {
        return;
    }

    unsigned long now = millis();

    // Don't sleep if there was recent activity (within 5 seconds)
    if (now - lastActivity < 5000) {
        return;
    }

    unsigned long timeUntilNextPhoto = 0;

    if (isCapturingPhotos && captureInterval > 0) {
        unsigned long timeSinceLastPhoto = now - lastCaptureTime;
        if (timeSinceLastPhoto < captureInterval) {
            timeUntilNextPhoto = captureInterval - timeSinceLastPhoto;
        }
    }

    // Only sleep if we have at least 10 seconds until next photo
    if (timeUntilNextPhoto > 10000) {
        // Configure light sleep to wake on BLE events and timer
        unsigned long sleepTime = timeUntilNextPhoto - 5000;
        if (sleepTime > 15000)
            sleepTime = 15000;                           // Max 15 seconds
        esp_sleep_enable_timer_wakeup(sleepTime * 1000); // Wake 5s before photo or max 15s
        esp_light_sleep_start();
        lastActivity = millis(); // Update activity time after wake
    }
}

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
    // Wake when the foil's raw value rises this much above the sleep benchmark
    touchSleepWakeUpEnable(TOUCH_SENSE_PIN, (uint32_t) (touchBaseline * TOUCH_TOUCH_RATIO));
    Serial.println("Entering deep sleep...");
    delay(100);
    esp_deep_sleep_start();
}

// -------------------------------------------------------------------------
// Audio Functions
// -------------------------------------------------------------------------
void onMicData(int16_t *data, size_t samples)
{
    // The VAD decides what reaches the encoder: silence stays in its pre-roll
    // ring and is never encoded or stored.
    vad_process(data, samples);
}

// Voiced PCM only (pre-roll flush + live frames while speaking).
void onVoicedPcm(int16_t *data, size_t samples)
{
    opus_receive_pcm(data, samples);
}

void onVadStateChange(bool speaking)
{
    if (speaking) {
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

    // SD-first: every encoded frame lands in the current utterance file. The
    // BLE TX ring below is the legacy live stream, still served when an app
    // explicitly subscribes (debug / no-SD fallback).
    if (storage_audio_utterance_open()) {
        storage_audio_write_frame(data, (uint16_t) len);
    }
    if (!connected || !audioSubscribed) {
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
    size_t maxValue = (negotiatedMtu > 6) ? (size_t)(negotiatedMtu - 3) : 20;
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
            audio_batch_buffer[pos++] = (uint8_t)len;
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
        lastActivity = millis(); // Register activity - prevents sleep
        Serial.println(">>> BLE Client connected.");
        // Send current battery level and unsynced stats on connect
        updateBatteryService();
        updateSyncStatus(true);
    }
    void onDisconnect(BLEServer *server) override
    {
        connected = false;
        audioSubscribed = false;
        negotiatedMtu = 23; // back to the BLE default until the next negotiation
        // Drop any in-flight sync transfer; the manifest ids are connection-
        // scoped, so the app starts over from SYNC_CMD_MANIFEST on reconnect.
        syncAbortRequested = true;
        Serial.println("<<< BLE Client disconnected. Restarting advertising.");
        BLEDevice::startAdvertising();
    }
    void onMtuChanged(BLEServer *server, esp_ble_gatts_cb_param_t *param) override
    {
        negotiatedMtu = param->mtu.mtu;
        Serial.printf("MTU negotiated: %u\n", negotiatedMtu);
    }
};

// Callback for Audio Data CCCD (Client Characteristic Configuration Descriptor)
class AudioCCCDCallback : public BLEDescriptorCallbacks
{
    void onWrite(BLEDescriptor *pDescriptor)
    {
        uint8_t *value = pDescriptor->getValue();
        if (value && pDescriptor->getLength() >= 2) {
            // Check notification bit (bit 0)
            if (value[0] & 0x01) {
                audioSubscribed = true;
                Serial.println("Audio notifications enabled");
            } else {
                audioSubscribed = false;
                Serial.println("Audio notifications disabled");
            }
        }
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
};

class PhotoControlCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *characteristic) override
    {
        if (characteristic->getLength() == 1) {
            int8_t received = characteristic->getData()[0];
            Serial.print("PhotoControl received: ");
            Serial.println(received);
            lastActivity = millis(); // Register activity - prevents sleep
            handlePhotoControl(received);
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
        lastActivity = millis();
        uint32_t fileId = 0;
        if (len >= 5) {
            fileId = (uint32_t) data[1] | ((uint32_t) data[2] << 8) | ((uint32_t) data[3] << 16) |
                     ((uint32_t) data[4] << 24);
        }
        switch (data[0]) {
        case SYNC_CMD_MANIFEST:
            syncManifestRequested = true;
            break;
        case SYNC_CMD_GET_FILE:
            syncRequestedFileId = fileId;
            syncFileRequested = true;
            break;
        case SYNC_CMD_ACK_FILE: {
            uint8_t nextHead = (syncAckHead + 1) % 8;
            if (nextHead != syncAckTail) { // Queue full: drop; the app retries unacked files next sync
                syncAckQueue[syncAckHead] = fileId;
                syncAckHead = nextHead;
            }
            break;
        }
        case SYNC_CMD_ABORT:
            syncAbortRequested = true;
            break;
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

class OTAControlCallback : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *pChar) override
    {
        std::string value = pChar->getValue();
        if (value.length() > 0) {
            ota_handle_command((uint8_t *) value.data(), value.length());
        }
    }

    void onRead(BLECharacteristic *pChar) override
    {
        uint8_t status[2] = {ota_get_status(), 0};
        pChar->setValue(status, 2);
    }
};

// -------------------------------------------------------------------------
// Battery Functions
// -------------------------------------------------------------------------
void readBatteryLevel()
{
    // Take multiple ADC readings for stability
    int adcSum = 0;
    for (int i = 0; i < 10; i++) {
        int value = analogRead(BATTERY_ADC_PIN);
        adcSum += value;
        delay(10);
    }
    int adcValue = adcSum / 10;

    // ESP32-S3 ADC: 12-bit (0-4095), reference voltage ~3.3V
    float adcVoltage = (adcValue / 4095.0f) * 3.3f;

    // Apply voltage divider ratio to get actual battery voltage
    batteryVoltage = adcVoltage * VOLTAGE_DIVIDER_RATIO;

    // Clamp voltage to reasonable range
    if (batteryVoltage > 5.0f)
        batteryVoltage = 5.0f;
    if (batteryVoltage < 2.5f)
        batteryVoltage = 2.5f;

    // Load-compensated battery calculation (accounts for voltage sag under load)
    float loadCompensatedMax = BATTERY_MAX_VOLTAGE;
    float loadCompensatedMin = BATTERY_MIN_VOLTAGE;

    // More accurate percentage calculation for load conditions
    if (batteryVoltage >= loadCompensatedMax) {
        batteryPercentage = 100;
    } else if (batteryVoltage <= loadCompensatedMin) {
        batteryPercentage = 0;
    } else {
        float range = loadCompensatedMax - loadCompensatedMin;
        batteryPercentage = (int) (((batteryVoltage - loadCompensatedMin) / range) * 100.0f);
    }

    // Smooth percentage changes to avoid jumpy readings
    static int lastBatteryPercentage = batteryPercentage;
    if (abs(batteryPercentage - lastBatteryPercentage) > 5) {
        batteryPercentage = lastBatteryPercentage + (batteryPercentage > lastBatteryPercentage ? 2 : -2);
    }
    lastBatteryPercentage = batteryPercentage;

    // Clamp percentage
    if (batteryPercentage > 100)
        batteryPercentage = 100;
    if (batteryPercentage < 0)
        batteryPercentage = 0;

    // Battery status with load info
    Serial.print("Battery: ");
    Serial.print(batteryVoltage);
    Serial.print("V (");
    Serial.print(batteryPercentage);
    Serial.print("%) [Load-compensated: ");
    Serial.print(loadCompensatedMin);
    Serial.print("V-");
    Serial.print(loadCompensatedMax);
    Serial.println("V]");
}

void updateBatteryService()
{
    if (batteryLevelCharacteristic) {
        uint8_t batteryLevel = (uint8_t) batteryPercentage;
        batteryLevelCharacteristic->setValue(&batteryLevel, 1);

        if (connected) {
            batteryLevelCharacteristic->notify();
        }
    }
}

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

// Drives the sync transfer a bounded amount per loop_app() pass so the touch
// sensor / button / photo capture stay responsive during multi-minute syncs.
void processSync(unsigned long now)
{
    if (syncAbortRequested) {
        syncAbortRequested = false;
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

    if (!connected || syncDataCharacteristic == nullptr) {
        return;
    }

    // Deletions for files the app verified. Throttled implicitly by the queue
    // depth; each delete is a single FAT operation.
    while (syncAckTail != syncAckHead) {
        uint32_t id = syncAckQueue[syncAckTail];
        syncAckTail = (syncAckTail + 1) % 8;
        manifest_entry_t *entry = findManifestEntry(id);
        if (entry != nullptr && entry->path[0] != '\0') {
            storage_delete_file(entry->path, entry->type, entry->size);
            entry->path[0] = '\0'; // Guard against double-ack
        }
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
            Serial.printf("sync: manifest built (%d entries)\n", syncManifestCount);
        }
    }

    if (syncFileRequested) {
        syncFileRequested = false;
        manifest_entry_t *entry = findManifestEntry(syncRequestedFileId);
        if (entry == nullptr || entry->path[0] == '\0') {
            syncSendFileError(syncRequestedFileId);
        } else {
            syncFile = entry;
            syncFileOffset = 0;
            syncFileSeq = 0;
            syncFileCrc = 0;
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
                syncDataCharacteristic->setValue(syncTxBuffer, 3);
                syncDataCharacteristic->notify();
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
            syncManifestSendIndex += n;
            syncDataCharacteristic->setValue(syncTxBuffer, pos);
            syncDataCharacteristic->notify();
            delay(SYNC_CHUNK_DELAY_MS);
        }
        lastActivity = now;
        return;
    }

    if (syncState == SYNC_SENDING_FILE && syncFile != nullptr) {
        size_t payloadMax = syncMaxValue() - 7; // [type][u32 id][u16 seq]
        for (int burst = 0; burst < SYNC_CHUNKS_PER_LOOP && syncState == SYNC_SENDING_FILE; burst++) {
            if (syncFileOffset >= syncFile->size) {
                syncTxBuffer[0] = SYNC_PKT_FILE_END;
                memcpy(&syncTxBuffer[1], &syncFile->id, 4);
                memcpy(&syncTxBuffer[5], &syncFileCrc, 4);
                syncDataCharacteristic->setValue(syncTxBuffer, 9);
                syncDataCharacteristic->notify();
                Serial.printf("sync: file %lu sent (%lu bytes)\n", (unsigned long) syncFile->id,
                              (unsigned long) syncFile->size);
                syncFile = nullptr;
                syncState = SYNC_IDLE;
                break;
            }
            int n = storage_read_file(syncFile->path, syncFileOffset, &syncTxBuffer[7], payloadMax);
            if (n <= 0) {
                syncSendFileError(syncFile->id);
                syncFile = nullptr;
                syncState = SYNC_IDLE;
                break;
            }
            syncTxBuffer[0] = SYNC_PKT_CHUNK;
            memcpy(&syncTxBuffer[1], &syncFile->id, 4);
            memcpy(&syncTxBuffer[5], &syncFileSeq, 2);
            syncFileCrc = esp_rom_crc32_le(syncFileCrc, &syncTxBuffer[7], n);
            syncDataCharacteristic->setValue(syncTxBuffer, 7 + n);
            syncDataCharacteristic->notify();
            syncFileOffset += n;
            syncFileSeq++;
            delay(SYNC_CHUNK_DELAY_MS);
        }
        lastActivity = now;
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

    // Main service
    BLEService *service = server->createService(serviceUUID);

    // Audio Data characteristic (for streaming audio to app)
    audioDataCharacteristic = service->createCharacteristic(
        audioDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    BLE2902 *audioCcc = new BLE2902();
    audioCcc->setNotifications(true);
    audioCcc->setCallbacks(new AudioCCCDCallback());
    audioDataCharacteristic->addDescriptor(audioCcc);
    audioDataCharacteristic->setCallbacks(new AudioDataCallback());

    // Audio Codec characteristic (tells app which codec we're using)
    audioCodecCharacteristic = service->createCharacteristic(audioCodecUUID, BLECharacteristic::PROPERTY_READ);
    uint8_t codecId = opus_get_codec_id();
    audioCodecCharacteristic->setValue(&codecId, 1);

    // Photo Data characteristic
    photoDataCharacteristic = service->createCharacteristic(
        photoDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    BLE2902 *ccc = new BLE2902();
    ccc->setNotifications(true);
    photoDataCharacteristic->addDescriptor(ccc);

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
    BLE2902 *syncStatusCcc = new BLE2902();
    syncStatusCcc->setNotifications(true);
    syncStatusCharacteristic->addDescriptor(syncStatusCcc);

    // Sync Control characteristic (manifest / file requests, acks, abort)
    syncControlCharacteristic = service->createCharacteristic(syncControlUUID, BLECharacteristic::PROPERTY_WRITE);
    syncControlCharacteristic->setCallbacks(new SyncControlCallback());

    // Sync Data characteristic (manifest entries + file chunks)
    syncDataCharacteristic = service->createCharacteristic(
        syncDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    BLE2902 *syncDataCcc = new BLE2902();
    syncDataCcc->setNotifications(true);
    syncDataCharacteristic->addDescriptor(syncDataCcc);

    // Time Sync characteristic (the app writes epoch ms on every connect)
    timeSyncCharacteristic = service->createCharacteristic(timeSyncUUID, BLECharacteristic::PROPERTY_WRITE);
    timeSyncCharacteristic->setCallbacks(new TimeSyncCallback());

    updateSyncStatus(false);

    // Battery Service
    BLEService *batteryService = server->createService(BATTERY_SERVICE_UUID);
    batteryLevelCharacteristic = batteryService->createCharacteristic(
        BATTERY_LEVEL_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    BLE2902 *batteryCcc = new BLE2902();
    batteryCcc->setNotifications(true);
    batteryLevelCharacteristic->addDescriptor(batteryCcc);

    // Set initial battery level
    readBatteryLevel();
    uint8_t initialBatteryLevel = (uint8_t) batteryPercentage;
    batteryLevelCharacteristic->setValue(&initialBatteryLevel, 1);

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
    otaControlCharacteristic->setCallbacks(new OTAControlCallback());

    // OTA Data characteristic (for progress notifications)
    otaDataCharacteristic = otaService->createCharacteristic(
        otaDataUUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    BLE2902 *otaCcc = new BLE2902();
    otaCcc->setNotifications(true);
    otaDataCharacteristic->addDescriptor(otaCcc);

    // Set OTA characteristics for the OTA module
    ota_set_characteristics(otaControlCharacteristic, otaDataCharacteristic);

    // Start services
    service->start();
    batteryService->start();
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

    lastActivity = millis(); // Register activity
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
        Serial.println("Camera initialized successfully.");
    }
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

    // Power optimization from config.h
    setCpuFrequencyMhz(NORMAL_CPU_FREQ_MHZ);
    lastActivity = millis();

    configure_ble();
    configure_camera();

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

    // Set default capture interval from config. isCapturingPhotos now means
    // "live BLE upload requested": with SD storage the interval capture runs
    // unconditionally and live upload stays off until the app writes
    // PHOTO_CONTROL; without SD the legacy default (stream when connected)
    // is kept.
    isCapturingPhotos = !storage_available();
    captureInterval = PHOTO_CAPTURE_INTERVAL_MS;
    lastCaptureTime = millis() - captureInterval;
    Serial.print("Default capture interval set to ");
    Serial.print(PHOTO_CAPTURE_INTERVAL_MS / 1000);
    Serial.println(" seconds.");

    // Initial battery reading
    // Battery voltage divider
    analogReadResolution(12);                           // optional: set 12-bit resolution
    analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_11db); // set attenuation for full 3.3V range

    readBatteryLevel();
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
    Serial.println("Light sleep optimization enabled for extended battery life.");
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
        Serial.printf("Wakeup cause: %d (0=power-on 3=button 4=timer 5=touch)\n",
                      (int) esp_sleep_get_wakeup_cause());
        wakeCauseLogged = true;
    }

#if TOUCH_DEBUG_LOG
    // Debug: LED mirrors the touch state so the threshold can be tuned without
    // a serial connection (LED is inverted: LOW = ON)
    if (touchDebugLed && ledMode == LED_NORMAL_OPERATION) {
        digitalWrite(STATUS_LED_PIN, LOW);
    }
#endif

    // Process OTA updates
    ota_loop();

    // Sync transfer (manifest / file chunks / acks / deferred time set)
    processSync(now);

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

    // Check for power save mode (gentle optimization)
    if (!connected && !photoDataUploading && (now - lastActivity > IDLE_THRESHOLD_MS)) {
        enterPowerSave();
    } else if (connected || photoDataUploading) {
        if (powerSaveMode)
            exitPowerSave();
        lastActivity = now;
    }

    // Check battery level periodically
    if (now - lastBatteryCheck >= BATTERY_TASK_INTERVAL_MS) {
        readBatteryLevel();
        updateBatteryService();
        lastBatteryCheck = now;
    }

    // Force battery update on first connection
    static bool firstBatteryUpdate = true;
    if (connected && firstBatteryUpdate) {
        readBatteryLevel();
        updateBatteryService();
        firstBatteryUpdate = false;
    }

    // Check if it's time to capture a photo.
    // SD-first: with a card mounted, photos are captured on the fixed interval
    // regardless of the BLE connection and saved to the card; the app pulls
    // them later via the sync protocol. The legacy live upload only runs when
    // the app explicitly asked for it via PHOTO_CONTROL (isCapturingPhotos),
    // which is also the no-SD fallback path.
    bool singleShot = isCapturingPhotos && captureInterval == 0;
    bool photoDue = singleShot || (now - lastCaptureTime >= (unsigned long) captureInterval);
    bool wantPhoto = storage_available() ? true : (isCapturingPhotos && connected);
    if (wantPhoto && !photoDataUploading && photoDue) {
        bool wantLiveUpload = isCapturingPhotos && connected;
        if (singleShot) {
            isCapturingPhotos = false;
            if (storage_available()) {
                captureInterval = PHOTO_CAPTURE_INTERVAL_MS; // resume interval capture to SD
            }
        }
        Serial.println("Interval reached. Capturing photo...");
        if (take_photo()) {
            lastCaptureTime = now;
            if (storage_available()) {
                storage_save_photo(fb->buf, fb->len, (uint8_t) current_photo_orientation);
            }
            if (wantLiveUpload) {
                Serial.println("Photo capture successful. Starting upload...");
                photoDataUploading = true;
                sent_photo_bytes = 0;
                sent_photo_frames = 0;
            } else {
                esp_camera_fb_return(fb);
                fb = nullptr;
            }
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

            lastActivity = now; // Register activity
        } else {
            // End of photo marker
            s_compressed_frame_2[0] = 0xFF;
            s_compressed_frame_2[1] = 0xFF;
            photoDataCharacteristic->setValue(s_compressed_frame_2, 2);
            photoDataCharacteristic->notify();
            Serial.println("Photo upload complete.");

            photoDataUploading = false;
            // Free camera buffer
            esp_camera_fb_return(fb);
            fb = nullptr;
            Serial.println("Camera frame buffer freed.");
            photo_chunks_this_loop = 0; // Reset counter
        }
    } else {
        photo_chunks_this_loop = 0; // Reset when not uploading
    }

    // Light sleep optimization - major power savings while maintaining BLE
    // Disable light sleep when audio is active
    if (!photoDataUploading && !audioSubscribed) {
        enableLightSleep();
    }

    // Adaptive delays for power saving (gentle optimization)
    if (photoDataUploading || audioSubscribed) {
        delay(5); // Fast during upload or audio streaming
    } else if (powerSaveMode) {
        delay(50); // Reduced delay with light sleep
    } else {
        delay(50); // Reduced delay with light sleep
    }
}
