# firmware

envsense device firmware for the XIAO ESP32S3 Sense. An Arduino sketch built with **arduino-cli**.
Derived from the omiGlass firmware.

See `firmware/README.md` for full setup details. This file covers the structure and the things to
watch out for when working here.

## Build / flash (arduino-cli)

One-time setup — install the ESP32 board package:

```bash
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core install esp32:esp32@2.0.17
```

Opus support requires cloning these into the Arduino `libraries/` folder:

```bash
git clone https://github.com/pschatzmann/arduino-libopus.git
git clone https://github.com/pschatzmann/arduino-audio-tools.git
```

Compile and upload. The FQBN **must** include `PSRAM=opi`, and the port comes from
`arduino-cli board list` (replace `COM5` with the actual port):

```bash
arduino-cli board list
arduino-cli compile --build-path build --output-dir dist \
  -e -u -p COM5 -b esp32:esp32:XIAO_ESP32S3:PSRAM=opi
```

To enter bootloader mode: hold **BOOT**, tap **RESET** once and release, then release **BOOT**.

## Code structure

`firmware.ino` and `src/main.cpp` are thin entry points that only call `setup_app()` /
`loop_app()`. **The real implementation lives in `src/app.cpp` (a ~1000-line monolith)** — it
handles the BLE server setup, camera, power management, button/LED, and audio TX. Feature files:

| File | Role |
| --- | --- |
| `src/app.cpp` | App body (BLE, camera, power, button, audio TX) |
| `src/config.h` | **Single source of truth for all configuration** (see below) |
| `src/mic.{cpp,h}` | I2S PDM microphone input |
| `src/opus_encoder.{cpp,h}` | Opus encoding |
| `src/ota.{cpp,h}` | OTA updates over WiFi |
| `src/camera_pins.h` / `src/camera_index.h` | Camera pin definitions / web UI (from omiGlass) |
| `src/mulaw.h` | μ-law (alternative audio codec) |

## config.h is the single source of configuration

The BLE UUIDs, GPIO pin assignments, power-management parameters (CPU frequency, sleep thresholds,
battery voltages), camera settings (resolution, JPEG quality), Opus parameters, and OTA
command/status codes **all live in `src/config.h`**. Edit config.h instead of hard-coding magic
numbers into app.cpp. `FIRMWARE_VERSION_STRING` is here too (the app reads it over BLE to switch
its image-rotation logic).

## BLE GATT services exposed

- envsense main service (`EA800000-…`): audio data/codec, photo data/control
- Battery Service (`0x180F`) / Device Information Service (`0x180A`)
- OTA service (`EA800010-…`): control + data (progress notifications)

The envsense UUID series (`EA80xxxx-9C72-497F-81F9-752FFE11F565`) is kept separate to avoid
collisions with OMI/Friend. **When you change it, update the companion app's BLE layer
(`apps/mobile/src/modules/`) at the same time.**

## Hardware assumptions / design notes

- CPU frequency, sleep behavior, and task intervals are aggressively tuned for a 6–10 hour
  battery life. When touching power-related constants, respect the rationale in the config.h
  comments.
- There is no physical power switch. Power on/off is done via a long button press → deep sleep
  (the hardware design lives under `hardware/`; see `hardware/clip/dimensions.md`).
- The camera is mounted upside down, so `FIXED_IMAGE_ORIENTATION` is set to 180°.

## Formatting

C/C++ follows `firmware/.clang-format` (LLVM-based, indent 4, line width 120, regrouped includes).
