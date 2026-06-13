#include "mic.h"

#include <driver/i2s_pdm.h>

#include "config.h"

// Static variables
static volatile bool mic_running = false;
static mic_data_handler audio_callback = nullptr;
static int16_t *i2s_read_buffer = nullptr;
static i2s_chan_handle_t rx_handle = nullptr;

bool mic_start()
{
    if (mic_running) {
        Serial.println("Microphone already running");
        return true;
    }

    Serial.println("Initializing I2S PDM microphone...");
    Serial.printf("  CLK Pin: GPIO%d\n", MIC_CLK_PIN);
    Serial.printf("  DATA Pin: GPIO%d\n", MIC_DATA_PIN);
    Serial.printf("  Sample Rate: %d Hz\n", MIC_SAMPLE_RATE);

    // Allocate buffer in PSRAM for better performance
    if (i2s_read_buffer == nullptr) {
        i2s_read_buffer = (int16_t *) ps_malloc(MIC_BUFFER_SAMPLES * sizeof(int16_t));
        if (i2s_read_buffer == nullptr) {
            Serial.println("Failed to allocate mic buffer in PSRAM!");
            // Try regular malloc as fallback
            i2s_read_buffer = (int16_t *) malloc(MIC_BUFFER_SAMPLES * sizeof(int16_t));
            if (i2s_read_buffer == nullptr) {
                Serial.println("Failed to allocate mic buffer!");
                return false;
            }
            Serial.println("Using regular RAM for mic buffer");
        } else {
            Serial.println("Using PSRAM for mic buffer");
        }
    }

    // Create an RX channel on I2S0 in master mode (new esp_driver_i2s API).
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    esp_err_t err = i2s_new_channel(&chan_cfg, nullptr, &rx_handle);
    if (err != ESP_OK) {
        Serial.printf("Failed to create I2S channel: %s\n", esp_err_to_name(err));
        return false;
    }

    // PDM RX: 16kHz, 16-bit, mono. The default slot config enables the
    // hardware high-pass filter (hp_en); the software DC blocker in
    // mic_process() stays as a belt-and-braces guard.
    i2s_pdm_rx_config_t pdm_rx_cfg = {
        .clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(MIC_SAMPLE_RATE),
        .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg =
            {
                .clk = (gpio_num_t) MIC_CLK_PIN,  // PDM CLK
                .din = (gpio_num_t) MIC_DATA_PIN, // PDM DATA
                .invert_flags =
                    {
                        .clk_inv = false,
                    },
            },
    };

    err = i2s_channel_init_pdm_rx_mode(rx_handle, &pdm_rx_cfg);
    if (err != ESP_OK) {
        Serial.printf("Failed to init I2S PDM RX: %s\n", esp_err_to_name(err));
        i2s_del_channel(rx_handle);
        rx_handle = nullptr;
        return false;
    }

    err = i2s_channel_enable(rx_handle);
    if (err != ESP_OK) {
        Serial.printf("Failed to enable I2S channel: %s\n", esp_err_to_name(err));
        i2s_del_channel(rx_handle);
        rx_handle = nullptr;
        return false;
    }

    mic_running = true;
    Serial.println("Microphone started successfully");
    return true;
}

void mic_stop()
{
    if (!mic_running) {
        return;
    }

    Serial.println("Stopping microphone...");

    if (rx_handle != nullptr) {
        i2s_channel_disable(rx_handle);
        i2s_del_channel(rx_handle);
        rx_handle = nullptr;
    }

    mic_running = false;
    Serial.println("Microphone stopped");
}

bool mic_is_running()
{
    return mic_running;
}

void mic_set_callback(mic_data_handler callback)
{
    audio_callback = callback;
}

void mic_process()
{
    if (!mic_running || i2s_read_buffer == nullptr || rx_handle == nullptr) {
        return;
    }

    size_t bytes_read = 0;
    // New driver: timeout is in milliseconds (not FreeRTOS ticks).
    esp_err_t err = i2s_channel_read(rx_handle, i2s_read_buffer, MIC_BUFFER_SAMPLES * sizeof(int16_t), &bytes_read, 20);

    if (err == ESP_OK && bytes_read > 0) {
        size_t samples_read = bytes_read / sizeof(int16_t);

        // Remove the PDM mic's DC bias, then apply gain. The bias is large
        // (~1900 raw, ~7500 after gain) and is removed before anything
        // downstream so it doesn't eat positive headroom and clip the waveform
        // asymmetrically (which would also skew what the VAD and Opus encoder
        // see). A one-pole DC blocker (y = x - x[-1] + R*y[-1]) high-passes it
        // out; State persists across calls so block boundaries don't thump.
        static float dcPrevIn = 0.0f;
        static float dcPrevOut = 0.0f;
        for (size_t i = 0; i < samples_read; i++) {
            float in = (float) i2s_read_buffer[i];
            float out = in - dcPrevIn + MIC_DC_BLOCK_POLE * dcPrevOut;
            dcPrevIn = in;
            dcPrevOut = out;
            int32_t sample = (int32_t) (out * MIC_GAIN);
            // Clamp to 16-bit range
            if (sample > 32767)
                sample = 32767;
            if (sample < -32768)
                sample = -32768;
            i2s_read_buffer[i] = (int16_t) sample;
        }

        if (audio_callback != nullptr) {
            audio_callback(i2s_read_buffer, samples_read);
        }
    }
}
