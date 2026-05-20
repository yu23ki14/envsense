# firmware

XIAO ESP32S3 Sense 向け envsense デバイスファームウェア（PlatformIO プロジェクト）。

> ファーム本体のソースは #36 でファイル単位移行する。現時点ではビルド構成のみ。
> `platformio.ini` / `partitions_ota.csv` / `.clang-format` は omiGlass のものを踏襲。

## 構成

| ファイル | 役割 |
| --- | --- |
| `platformio.ini` | ビルド環境定義 |
| `partitions_ota.csv` | OTA 対応パーティションテーブル（8MB flash） |
| `src/` | ファームウェアソース（#36 で投入） |
| `scripts/` | UF2 ビルド / 書き込み補助スクリプト |
| `.clang-format` | C / C++ フォーマット設定 |

board: `seeed_xiao_esp32s3` / framework: `arduino` / memory type: `qio_opi`（PSRAM 有効）。

## ビルド環境

| Environment | upload_speed | 用途 |
| --- | --- | --- |
| `seeed_xiao_esp32s3` | 115200 | 標準（開発用） |
| `seeed_xiao_esp32s3_slow` | 57600 | 書き込み低速・詳細ログ（接続が不安定なとき） |

## 前提

- [PlatformIO Core](https://platformio.org/install)
- XIAO ESP32S3 Sense を USB-C で接続

### PlatformIO Core のインストール

`pip install platformio` を共有 Python 環境（pyenv の global など）へ直接入れると
依存パッケージが衝突しやすい。**専用 venv に隔離**してインストールする:

```bash
python3 -m venv ~/.platformio/penv
~/.platformio/penv/bin/pip install platformio
ln -s ~/.platformio/penv/bin/pio ~/.local/bin/pio   # ~/.local/bin が PATH 上にある前提
```

`pipx install platformio` でも可。`pio --version` が通れば OK。

## ブートローダーモードへの入り方

1. **BOOT** ボタンを押し続ける
2. 押したまま **RESET** を一度押して離す
3. **BOOT** を離す

## PlatformIO でのビルド / 書き込み

```bash
cd firmware

# ビルド
pio run -e seeed_xiao_esp32s3

# 書き込み（ブートローダーモードで実行）
pio run -e seeed_xiao_esp32s3 --target upload

# 接続が不安定な場合は低速環境
pio run -e seeed_xiao_esp32s3_slow --target upload

# シリアルモニタ
pio device monitor --baud 115200
```

`lib_deps`（NimBLE-Arduino / esp32-camera / arduino-libopus）は初回ビルド時に自動取得される。

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

書き込み補助スクリプト（ポート自動検出 + 環境フォールバック）:

```bash
./scripts/flash_esp32.sh      # bash 版
python3 scripts/flash_esp32.py  # Python 版
```

## arduino-cli でのビルド / 書き込み

ESP32 ボード定義をインストール:

```bash
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core install esp32:esp32@2.0.17
```

ポートを確認し、FQBN に `PSRAM=opi` を指定してコンパイル・書き込み（`COM5` は実際のポートに置換）:

```bash
arduino-cli board list
arduino-cli compile --build-path build --output-dir dist \
  -e -u -p COM5 -b esp32:esp32:XIAO_ESP32S3:PSRAM=opi
```

Opus サポートには以下を Arduino の libraries フォルダへ clone する（arduino-cli 利用時のみ必要、
PlatformIO では `lib_deps` で自動取得）:

```bash
git clone https://github.com/pschatzmann/arduino-libopus.git
git clone https://github.com/pschatzmann/arduino-audio-tools.git
```

## ライブラリ依存

`platformio.ini` の `lib_deps`:

- `h2zero/NimBLE-Arduino` — BLE 通信
- `espressif/esp32-camera` — カメラ（OV2640）
- `pschatzmann/arduino-libopus` — Opus 音声コーデック
