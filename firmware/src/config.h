#ifndef CONFIG_H
#define CONFIG_H

// =============================================================================
// BOARD CONFIGURATION - Must be defined before camera includes
// =============================================================================
#define CAMERA_MODEL_XIAO_ESP32S3 // Define camera model for Seeed Xiao ESP32S3
#define BOARD_HAS_PSRAM           // Enable PSRAM support
#define CONFIG_ARDUHAL_ESP_LOG    // Enable Arduino HAL logging

// =============================================================================
// DEVICE CONFIGURATION
// =============================================================================
#define BLE_DEVICE_NAME "envsense"
#define FIRMWARE_VERSION_STRING "2.6.0"
#define HARDWARE_REVISION "ESP32-S3-v1.0"
#define MANUFACTURER_NAME "envsense"

// =============================================================================
// POWER MANAGEMENT - Optimized for MINIMUM 6-8 hours, targeting 10+ hours
// =============================================================================
// CPU Frequency - fixed at 80MHz. Below 80MHz the CPU clocks from the 40MHz
// XTAL and the PLL powers down, which kills the I2S/PDM mic clock; since VAD
// capture is always on, the clock must never drop. Idle savings come from VAD
// skipping the Opus encode + SD writes during silence.
#define NORMAL_CPU_FREQ_MHZ 80 // Operating frequency (fixed)

// Battery Configuration - Dual 250mAh @ 3.5V-4.1V under load (500mAh total)
#define BATTERY_MAX_VOLTAGE 4.2f      // 4.2V fully charged (under load)
#define BATTERY_MIN_VOLTAGE 3.2f      // 3.2V empty (under load)
#define BATTERY_CRITICAL_VOLTAGE 3.3f // Emergency shutdown voltage
#define BATTERY_LOW_VOLTAGE 3.4f      // Low battery warning
#define VOLTAGE_DIVIDER_RATIO 6.086f  // Calibrated to match multimeter readings (load-compensated)

// Battery Monitoring - Extended intervals for power savings
#define BATTERY_REPORT_INTERVAL_MS 90000 // 1.5 minute reporting (was 60s)
#define BATTERY_TASK_INTERVAL_MS 20000   // 20 second internal checks (was 15s)
#define BATTERY_ADC_PIN 2                // GPIO2 (A1) - voltage divider connection

// =============================================================================
// CAMERA CONFIGURATION - Power optimized for 6-8 hour battery life
// =============================================================================
#define CAMERA_FRAME_SIZE FRAMESIZE_XGA // 1024x768 - good detail for Vision, fits BLE budget
#define CAMERA_JPEG_QUALITY 12          // esp_camera quality is inverted (0=best..63=worst); 12 = high
#define CAMERA_XCLK_FREQ 20000000       // 20MHz - sensor standard; 6MHz was too low for higher res
#define CAMERA_FB_IN_PSRAM CAMERA_FB_IN_PSRAM
#define CAMERA_GRAB_LATEST CAMERA_GRAB_LATEST

// Fixed Photo Capture Interval - Optimized for 6-8 hour operation
#define PHOTO_CAPTURE_INTERVAL_MS 30000 // Fixed 30 second interval
#define CAMERA_TASK_INTERVAL_MS 2000    // 2 second task check
#define CAMERA_TASK_STACK_SIZE 3072     // Reduced stack size
#define CAMERA_TASK_PRIORITY 2

// Camera Power Management - Reduce power cycling
#define CAMERA_POWER_DOWN_DELAY_MS 60000 // Power down camera after 60s idle (was 8s)

// =============================================================================
// IMAGE ORIENTATION
// =============================================================================
typedef enum {
    ORIENTATION_0_DEGREES = 0,   // Normal
    ORIENTATION_90_DEGREES = 1,  // Rotated right
    ORIENTATION_180_DEGREES = 2, // Upside down
    ORIENTATION_270_DEGREES = 3  // Rotated left
} image_orientation_t;

// The device is mounted upside down, so we need to rotate 180 degrees.
#define FIXED_IMAGE_ORIENTATION ORIENTATION_180_DEGREES

// =============================================================================
// BLE CONFIGURATION - Power optimized for extended battery life
// =============================================================================
#define BLE_MTU_SIZE 517            // Maximum MTU for efficiency
#define BLE_CHUNK_SIZE 500          // Safe chunk size for photo transfer
#define BLE_PHOTO_TRANSFER_DELAY 3  // Fast transfer for connection stability
#define BLE_TX_POWER ESP_PWR_LVL_N0 // Low power for 6+ hour battery life

// Power-optimized BLE Advertising - Longer intervals for power savings
#define BLE_ADV_MIN_INTERVAL 0x0140  // 200ms minimum (was 160ms)
#define BLE_ADV_MAX_INTERVAL 0x0280  // 400ms maximum (was 320ms)
#define BLE_ADV_TIMEOUT_MS 0         // Never stop advertising (always discoverable)
#define BLE_SLEEP_ADV_INTERVAL 45000 // Re-advertise every 45 seconds when not connected (was 30s)

// Connection Management - Stable connections with power optimization
#define BLE_CONNECTION_TIMEOUT_MS 0 // Never timeout connections (disable auto-disconnect)
#define BLE_TASK_INTERVAL_MS 20000  // 20 second connection check (was 15s)
#define BLE_TASK_STACK_SIZE 2048
#define BLE_TASK_PRIORITY 1

// Connection Parameters for Stable Connections with Power Optimization
#define BLE_CONN_MIN_INTERVAL 20 // 25ms minimum connection interval (was 20ms)
#define BLE_CONN_MAX_INTERVAL 40 // 50ms maximum connection interval (was 40ms)
#define BLE_CONN_LATENCY 0       // No latency for immediate response
#define BLE_CONN_TIMEOUT 800     // 8 second supervision timeout

// =============================================================================
// TASK CONFIGURATION - Optimized stack sizes
// =============================================================================
#define BATTERY_TASK_STACK_SIZE 2048
#define BATTERY_TASK_PRIORITY 1
#define POWER_MANAGEMENT_TASK_STACK_SIZE 2048
#define POWER_MANAGEMENT_TASK_PRIORITY 0

// Status Reporting - Power optimized
#define STATUS_REPORT_INTERVAL_MS 120000 // 2 minutes (was 30 seconds)

// =============================================================================
// MICROPHONE CONFIGURATION - I2S PDM (XIAO ESP32S3 Sense built-in mic)
// =============================================================================
// XIAO ESP32S3 Sense has built-in PDM microphone
#define MIC_CLK_PIN 42  // PDM Clock pin (GPIO42)
#define MIC_DATA_PIN 41 // PDM Data pin (GPIO41)

#define MIC_SAMPLE_RATE 16000   // 16kHz sample rate
#define MIC_BUFFER_SAMPLES 1600 // 100ms buffer (16000 * 0.1)
#define MIC_GAIN 4              // Microphone gain multiplier (clamped to int16 in mic.cpp)
// One-pole DC blocker applied in mic_process before gain. The PDM mic sits on a
// large DC pedestal (~1900 raw); left in, the energy VAD reads it as permanent
// speech. Closer to 1.0 = lower corner frequency; 0.995 @ 16kHz ≈ 13Hz, well
// below speech so it only strips the bias/sub-sonic rumble.
#define MIC_DC_BLOCK_POLE 0.995f
// Must hold the VAD pre-roll flush (1s) plus live PCM headroom: when speech
// starts, vad.cpp dumps VAD_PREROLL_MS of buffered samples into this ring at
// once, before opus_process() drains it.
#define AUDIO_RING_BUFFER_SAMPLES 24000 // 1.5s of audio data (PSRAM)

// =============================================================================
// OPUS CODEC CONFIGURATION
// =============================================================================
#define AUDIO_CODEC_ID 21         // Opus codec ID (matches Omi protocol)
#define OPUS_FRAME_SAMPLES 320    // 20ms frame @ 16kHz
#define OPUS_OUTPUT_MAX_BYTES 160 // Max encoded frame size
#define OPUS_BITRATE 32000        // 32kbps
#define OPUS_COMPLEXITY 3         // Encoding complexity (1-10)
#define OPUS_VBR 1                // Variable bitrate enabled

// Audio BLE packet configuration
#define AUDIO_PACKET_HEADER_SIZE 3   // 2 bytes index + 1 byte frame count
#define AUDIO_TX_RING_BUFFER_SIZE 64 // Encoded frames buffered (~1.3s) to ride out TX stalls

// =============================================================================
// VAD (Voice Activity Detection) - silence is neither encoded nor stored
// =============================================================================
// esp-sr's WebRTC-derived esp_vad judges each 20ms PCM frame on spectral
// features rather than bare energy, so stationary room noise no longer reads as
// speech the way the old mean|amplitude| threshold did. VAD_MODE 0..4 trades
// sensitivity for noise rejection (0 = normal/flags more speech, 4 = very
// aggressive/rejects more, may clip quiet onsets). The trigger-frame count and
// 1s pre-roll below already protect onsets, so a higher mode is fairly safe;
// raise it if noise still leaks, lower it if quiet speech gets dropped.
#define VAD_MODE 3           // esp_vad aggressiveness 0..4 (higher = more noise rejection)
#define VAD_TRIGGER_FRAMES 4 // Consecutive voiced frames to start an utterance (80ms; rejects short noise bursts)
#define VAD_HANGOVER_MS 1200 // Silence that ends an utterance (bridges normal speech pauses)
#define VAD_PREROLL_MS 1000  // PCM kept before the trigger so speech onsets aren't clipped
#define VAD_DEBUG_LOG 0      // 1: log per-second VAD state for mode tuning

// =============================================================================
// MICROSD STORAGE - SD-first capture (XIAO ESP32S3 Sense expansion board)
// =============================================================================
// The Sense board's microSD sits on the default SPI bus (SCK=GPIO7, MISO=GPIO8,
// MOSI=GPIO9) with CS on GPIO21. GPIO21 is ALSO the user LED (STATUS_LED_PIN):
// once the SD card is mounted the firmware stops driving the LED entirely --
// any digitalWrite to it would yank the card's chip select mid-transaction and
// corrupt the filesystem. The LED is only used before storage_init().
#define SD_CS_PIN 21
#define SD_SPI_FREQ_HZ 20000000  // 20MHz; conservative for wiring through the expansion board
#define AUDIO_DIR "/audio"       // Utterance files: <epoch_ms>.opp (length-prefixed Opus frames)
#define PHOTO_DIR "/photo"       // Photo files: <epoch_ms>_<orientation>.jpg
#define AUDIO_FILE_MAX_MS 300000 // Split utterances at 5 min to bound the BLE transfer unit
#define STORAGE_FLUSH_BYTES 4096 // Buffer audio frames and write to SD in 4KB batches
// Clocks below this (2021-01-01 UTC) are "invalid": the RTC lost power and the
// app hasn't written TIME_SYNC yet. Files recorded before the first sync get
// their timestamps shifted forward when the real time arrives.
#define CLOCK_VALID_MIN_EPOCH_MS 1609459200000ULL

// =============================================================================
// SYNC TRANSFER - bulk file transfer to the app over BLE (see SYNC_* UUIDs)
// =============================================================================
#define SYNC_MANIFEST_MAX_ENTRIES 2048 // Manifest table in PSRAM (~1 day of photos + utterances)
#define SYNC_CHUNKS_PER_LOOP 16        // Max file chunks attempted per loop_app() pass (keeps touch/button responsive)
#define SYNC_CHUNK_DELAY_MS 1          // Pause between chunk notifications so the BLE stack can flush
#define SYNC_CONGESTION_BACKOFF_MS                                                                                     \
    5 // Wait after a notify is rejected (TX buffer full) before resending — under one connection interval so throughput
      // stays high
// Fast connection interval requested on connect (units of 1.25 ms). A short
// interval lets the central poll often, which is the main lever for bulk-sync
// throughput; both iOS and Android honor a reasonable request.
#define SYNC_CONN_INTERVAL_MIN 6          // 7.5 ms
#define SYNC_CONN_INTERVAL_MAX 12         // 15 ms
#define SYNC_CONN_SUPERVISION_TIMEOUT 400 // 4 s
#define SYNC_STATUS_INTERVAL_MS 10000     // Min interval between unsynced-stats notifications

// =============================================================================
// BLE UUID DEFINITIONS - envsense Protocol
// envsense-specific 128-bit UUID series (base EA80xxxx-9C72-497F-81F9-752FFE11F565),
// distinct from the OMI/Friend protocol UUIDs to avoid collisions with omi devices.
// The companion app's BLE layer (#37) must use the same UUIDs.
// =============================================================================
#define ENVSENSE_SERVICE_UUID "EA800000-9C72-497F-81F9-752FFE11F565"
#define AUDIO_DATA_UUID "EA800001-9C72-497F-81F9-752FFE11F565"
#define AUDIO_CODEC_UUID "EA800002-9C72-497F-81F9-752FFE11F565"
#define PHOTO_DATA_UUID "EA800005-9C72-497F-81F9-752FFE11F565"
#define PHOTO_CONTROL_UUID "EA800006-9C72-497F-81F9-752FFE11F565"
#define POWER_CONTROL_UUID "EA800007-9C72-497F-81F9-752FFE11F565"
#define SYNC_STATUS_UUID "EA800008-9C72-497F-81F9-752FFE11F565"
#define SYNC_CONTROL_UUID "EA800009-9C72-497F-81F9-752FFE11F565"
#define SYNC_DATA_UUID "EA80000A-9C72-497F-81F9-752FFE11F565"
#define TIME_SYNC_UUID "EA80000B-9C72-497F-81F9-752FFE11F565"
#define MODE_CONTROL_UUID "EA80000C-9C72-497F-81F9-752FFE11F565"

// Power commands (written to POWER_CONTROL_UUID)
#define POWER_CMD_SLEEP 0x01  // Enter deep sleep (same as touch / button long press)
#define POWER_CMD_REBOOT 0x02 // Restart the device

// Capture modes (MODE_CONTROL, read/write/notify; 1 byte). Persisted in NVS.
// LOCAL records photos + VAD audio to the microSD only (pulled later via the
// sync protocol). STREAMING sends them live over PHOTO_DATA / AUDIO_DATA while
// connected and falls back to the SD while out of range so nothing is lost.
// A LOCAL request without a mounted card is rejected: the device keeps running
// in STREAMING and notifies the effective mode back to the app.
#define CAPTURE_MODE_LOCAL 0x01
#define CAPTURE_MODE_STREAMING 0x02

// -----------------------------------------------------------------------------
// Sync protocol (microSD -> app bulk transfer). All integers little-endian.
//
// TIME_SYNC (write): [u64 epoch_ms] -- the app writes this on every connect.
//
// SYNC_STATUS (read/notify): [u16 audioFiles][u16 photoFiles][u32 totalBytes][u8 flags]
#define SYNC_FLAG_SD_OK 0x01       // SD card mounted; SD-first capture is active
#define SYNC_FLAG_CLOCK_VALID 0x02 // Device clock has been set since the last power loss
//
// SYNC_CONTROL (write): [cmd, ...]
#define SYNC_CMD_MANIFEST 0x01 // [cmd] -> manifest entries stream over SYNC_DATA
#define SYNC_CMD_GET_FILE 0x02 // [cmd][u32 fileId] -> file chunks stream over SYNC_DATA
#define SYNC_CMD_ACK_FILE 0x03 // [cmd][u32 fileId] -> file verified by the app; delete from SD
#define SYNC_CMD_ABORT 0x04    // [cmd] -> stop the current transfer
#define SYNC_CMD_PURGE 0x05    // [cmd] -> delete ALL unsynced files without transferring
//
// SYNC_DATA (notify): first byte is the packet type
#define SYNC_PKT_MANIFEST_END 0x00 // [type][u16 entryCount]
#define SYNC_PKT_MANIFEST 0x01 // [type][u8 n] then n * ([u32 id][u8 fileType][u32 size][u64 epochMs][u8 orientation])
#define SYNC_PKT_CHUNK 0x02    // [type][u32 id][u16 seq][payload...]
#define SYNC_PKT_FILE_END 0x03 // [type][u32 id][u32 crc32(IEEE)]
#define SYNC_PKT_ERROR 0x7F    // [type][u32 id] -- requested file unavailable
#define SYNC_MANIFEST_ENTRY_BYTES 18
#define SYNC_FILE_TYPE_AUDIO 0
#define SYNC_FILE_TYPE_PHOTO 1
// -----------------------------------------------------------------------------

// Battery Service UUID - Cast to uint16_t for BLE compatibility
#define BATTERY_SERVICE_UUID (uint16_t) 0x180F
#define BATTERY_LEVEL_UUID (uint16_t) 0x2A19

// OTA Service UUIDs
#define OTA_SERVICE_UUID "EA800010-9C72-497F-81F9-752FFE11F565"
#define OTA_CONTROL_UUID "EA800011-9C72-497F-81F9-752FFE11F565" // Write commands, read status
#define OTA_DATA_UUID "EA800012-9C72-497F-81F9-752FFE11F565"    // Notifications for progress

// OTA Commands (written to OTA_CONTROL_UUID)
#define OTA_CMD_SET_WIFI 0x01   // Set WiFi credentials: [cmd, ssid_len, ssid..., pass_len, pass...]
#define OTA_CMD_START_OTA 0x02  // Start OTA update: [cmd, url_len, url...]
#define OTA_CMD_CANCEL_OTA 0x03 // Cancel ongoing OTA
#define OTA_CMD_GET_STATUS 0x04 // Request current status
#define OTA_CMD_SET_URL 0x05    // Set firmware URL: [cmd, url_len, url...]

// OTA Status codes (notified via OTA_DATA_UUID)
#define OTA_STATUS_IDLE 0x00
#define OTA_STATUS_WIFI_CONNECTING 0x10
#define OTA_STATUS_WIFI_CONNECTED 0x11
#define OTA_STATUS_WIFI_FAILED 0x12
#define OTA_STATUS_DOWNLOADING 0x20 // Followed by progress byte (0-100)
#define OTA_STATUS_DOWNLOAD_COMPLETE 0x21
#define OTA_STATUS_DOWNLOAD_FAILED 0x22
#define OTA_STATUS_INSTALLING 0x30 // Followed by progress byte (0-100)
#define OTA_STATUS_INSTALL_COMPLETE 0x31
#define OTA_STATUS_INSTALL_FAILED 0x32
#define OTA_STATUS_REBOOTING 0x40
#define OTA_STATUS_ERROR 0xFF

// WiFi Configuration
#define WIFI_CONNECT_TIMEOUT_MS 15000 // 15 seconds to connect
#define WIFI_MAX_SSID_LEN 32
#define WIFI_MAX_PASS_LEN 64
#define OTA_MAX_URL_LEN 256

// =============================================================================
// PIN DEFINITIONS (from camera_pins.h integration)
// =============================================================================
#ifdef CAMERA_MODEL_XIAO_ESP32S3
#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 10
#define SIOD_GPIO_NUM 40
#define SIOC_GPIO_NUM 39
#define Y9_GPIO_NUM 48
#define Y8_GPIO_NUM 11
#define Y7_GPIO_NUM 12
#define Y6_GPIO_NUM 14
#define Y5_GPIO_NUM 16
#define Y4_GPIO_NUM 18
#define Y3_GPIO_NUM 17
#define Y2_GPIO_NUM 15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM 47
#define PCLK_GPIO_NUM 13

// Power Button and LED Control
#define POWER_BUTTON_PIN 1 // Custom button (GPIO1/A0) - power on/off
#define STATUS_LED_PIN 21  // User LED (GPIO21) - status indicator
#endif

// =============================================================================
// POWER BUTTON & LED CONFIGURATION
// =============================================================================
// Button Configuration
#define BUTTON_DEBOUNCE_MS 50       // Button debounce time
#define POWER_OFF_PRESS_MS 2000     // Long press duration for power off (2 seconds)
#define BOOT_COMPLETE_DELAY_MS 3000 // LED indication during boot

// LED Status Patterns (in milliseconds)
#define LED_BOOT_BLINK_FAST 200     // Fast blink during boot
#define LED_BATTERY_LOW_BLINK 1000  // Slow blink for low battery
#define LED_PHOTO_CAPTURE_FLASH 100 // Quick flash during photo capture

// =============================================================================
// TOUCH SENSOR CONFIGURATION - copper foil pad on GPIO3 (D2 / TOUCH3)
// Hold the foil for TOUCH_HOLD_OFF_MS to power off; touching it again wakes
// the device from deep sleep (the power button keeps working for both too).
// =============================================================================
#define TOUCH_SENSE_PIN 3      // GPIO3 (D2) - copper foil capacitive pad
#define TOUCH_HOLD_OFF_MS 2000 // Hold duration to power off (same as button long press)
#define TOUCH_TOUCH_RATIO                                                                                              \
    0.05f                           // Enter touched state when filtered > baseline * (1 + ratio).
                                    // Kept low because on battery the device ground floats and the
                                    // touch delta shrinks to a fraction of the USB-powered value.
#define TOUCH_RELEASE_RATIO 0.025f  // Leave touched state when filtered < baseline * (1 + ratio)
#define TOUCH_FILTER_SAMPLES 5      // Raw reads per poll; the median rejects single-sample noise
#define TOUCH_BASELINE_SAMPLES 16   // Boot-time calibration sample count (foil must be untouched)
#define TOUCH_BASELINE_ALPHA 0.005f // Baseline EMA rate for downward drift (~10s at 50ms poll)
#define TOUCH_BASELINE_ALPHA_UP                                                                                        \
    0.0005f // Upward drift tracked 10x slower so a sub-threshold touch
            // (small battery-powered delta) is not absorbed as baseline
#define TOUCH_MEASURE_CYCLES                                                                                           \
    2000                            // Touch FSM charge cycles per read (S3 default 500); longer
                                    // integration = better SNR, which the low thresholds rely on
#define TOUCH_SLEEP_CYCLES 0x0F     // Interval between HW measurements (S3 default)
#define TOUCH_SAMPLE_INTERVAL_MS 50 // Polling interval in the main loop
#define TOUCH_DEBUG_LOG 0           // 1: log raw values every second + LED mirrors touch state (calibration)

// Power Button States
typedef enum { BUTTON_IDLE, BUTTON_PRESSED, BUTTON_LONG_PRESS, BUTTON_RELEASED } button_state_t;

// LED Status Modes
typedef enum {
    LED_OFF,
    LED_ON,
    LED_BOOT_SEQUENCE,
    LED_NORMAL_OPERATION,
    LED_LOW_BATTERY,
    LED_PHOTO_CAPTURE,
    LED_POWER_OFF_SEQUENCE
} led_status_t;

// Device Power States
typedef enum {
    DEVICE_BOOTING,
    DEVICE_ACTIVE,
    DEVICE_POWER_SAVE,
    DEVICE_LOW_BATTERY,
    DEVICE_POWERING_OFF
} device_state_t;

#endif // CONFIG_H
