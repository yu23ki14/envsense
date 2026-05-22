# firmware

XIAO ESP32S3 Sense 向け envsense デバイスファームウェア。Arduino スケッチで、
**arduino-cli** でビルドする。omiGlass のファームから派生。

## 構成

| ファイル | 役割 |
| --- | --- |
| `firmware.ino` | Arduino スケッチのエントリ（`src/app.h` を include するだけ） |
| `src/` | ファームウェアソース本体 |
| `partitions_ota.csv` | OTA 対応パーティションテーブル（8MB flash） |
| `scripts/` | UF2 ビルド / 書き込み補助スクリプト |
| `.clang-format` | C / C++ フォーマット設定 |
| `platformio.ini` | PlatformIO 用ビルド定義（代替ビルド手段。下記参照） |

board: `XIAO_ESP32S3` / framework: `arduino` / PSRAM: `opi`（有効）。

## 前提

- [arduino-cli](https://arduino.github.io/arduino-cli/)
- XIAO ESP32S3 Sense を USB-C で接続

### ESP32 ボード定義のインストール

```bash
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core install esp32:esp32@2.0.17
```

### Opus ライブラリのインストール

Opus 音声コーデックには以下を Arduino の `libraries/` フォルダへ clone する:

```bash
git clone https://github.com/pschatzmann/arduino-libopus.git
git clone https://github.com/pschatzmann/arduino-audio-tools.git
```

NimBLE-Arduino / esp32-camera は ESP32 ボード定義に含まれる。

## ブートローダーモードへの入り方

1. **BOOT** ボタンを押し続ける
2. 押したまま **RESET** を一度押して離す
3. **BOOT** を離す

## arduino-cli でのビルド / 書き込み

ポートを確認し、FQBN に `PSRAM=opi` を指定してコンパイル・書き込み（`COM5` は
`arduino-cli board list` で確認した実際のポートに置換）:

```bash
cd firmware

# ポート確認
arduino-cli board list

# コンパイル + 書き込み（-u）
arduino-cli compile --build-path build --output-dir dist \
  -e -u -p COM5 -b esp32:esp32:XIAO_ESP32S3:PSRAM=opi

# シリアルモニタ
arduino-cli monitor -p COM5 -c baudrate=115200
```

接続が不安定なときは、書き込み補助スクリプト（ポート自動検出 + フォールバック）も使える:

```bash
./scripts/flash_esp32.sh        # bash 版
python3 scripts/flash_esp32.py  # Python 版
```

## UF2 での書き込み（ドラッグ & ドロップ）

`scripts/` の UF2 ビルダーでファームを `.uf2` 化し、ブートローダーモードで現れる
USB ドライブ（`ESP32S3`）にコピーするだけで書き込める。

```bash
cd firmware

# ビルド + UF2 生成（envsense_firmware.uf2 が出力される）
./scripts/build_uf2.sh

# 既存バイナリを変換するだけ
./scripts/build_uf2.sh --convert-only
```

## ライブラリ依存

- `h2zero/NimBLE-Arduino` — BLE 通信
- `espressif/esp32-camera` — カメラ（OV2640）
- `pschatzmann/arduino-libopus` — Opus 音声コーデック

## PlatformIO でのビルド（代替）

`platformio.ini` を残してあるので [PlatformIO Core](https://platformio.org/install) でも
ビルドできる。`lib_deps`（NimBLE-Arduino / esp32-camera / arduino-libopus）は初回ビルドで
自動取得される。

| Environment | upload_speed | 用途 |
| --- | --- | --- |
| `seeed_xiao_esp32s3` | 115200 | 標準 |
| `seeed_xiao_esp32s3_slow` | 57600 | 書き込み低速・詳細ログ（接続が不安定なとき） |

```bash
cd firmware
pio run -e seeed_xiao_esp32s3                    # ビルド
pio run -e seeed_xiao_esp32s3 --target upload    # 書き込み（ブートローダーモードで）
pio device monitor --baud 115200                 # シリアルモニタ
```
