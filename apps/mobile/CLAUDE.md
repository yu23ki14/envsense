@AGENTS.md

# apps/mobile

Companion mobile app for the envsense device. Expo SDK 55 / React 19 / React Native 0.83, with the
New Architecture enabled. Runs on three targets: iOS, Android, and web.

> Expo changes a lot between versions. Before writing any Expo-related code, follow the `AGENTS.md`
> instruction above and consult the versioned v55 docs (https://docs.expo.dev/versions/v55.0.0/).

## Commands

From the repo root use `pnpm mobile <script>`; from this directory use `pnpm <script>`.

| Script | Description |
| --- | --- |
| `start` / `ios` / `android` / `web` | Launch Expo |
| `typecheck` | `tsc --noEmit` |
| `tokens` | Regenerate the DADS design tokens (see below) |
| `check:colors` | Check the design system for hard-coded color literals |

## Startup ordering constraint

The entry point is `index.ts`. It imports `src/ui/unistyles` **before anything else** and then
`expo-router/entry`, because Unistyles' `StyleSheet.configure` must run before any
`StyleSheet.create` call. Keep this import order — breaking it crashes the app with an
unconfigured theme.

## Navigation & screen structure

Navigation uses **expo-router** (file-based routing). Routes live in `app/`:

- `app/_layout.tsx` — root Stack: font loading + splash, plus the `(tabs)` group and the
  `journal` / `export` modal routes.
- `app/(tabs)/` — bottom tab navigation (今日 / 記録 / デバイス). The tab bar is the custom
  `src/components/ClipTabBar`.
- Shared shell components live in `src/components/` (built on the `src/ui` design system);
  screen bodies will live in `src/screens/` (added per screen).

Keep route files in `app/` thin — the Unistyles babel plugin only transforms files under `src`
(see `babel.config.js`), so put styled components in `src/` and have routes just compose them.

## BLE layer (`src/modules/ble/`)

Platform separation is essential. The `BleClient` interface in `types.ts` is implemented by
`ble.native.ts` (react-native-ble-plx) and `ble.web.ts` (Web Bluetooth); `index.ts` picks one via
a **dynamic import** based on `Platform.OS`. This keeps the native bridge out of the web bundle
and the Web Bluetooth references out of the native bundle. **Always write BLE features against
this abstraction** (`BleClient` / `BleDevice` / `BleService` / `BleCharacteristic`) — never call
platform-specific APIs directly.

The UUIDs and packet formats must match the firmware (`firmware/src/config.h`).

## Device integration pipeline

`src/modules/useDeviceCapture.ts` is the single subscription that runs while a device is connected
(mounted once by `DeviceProvider`). It handles both media streams:

- **Photos**: subscribes to the photo characteristics and reassembles the chunked JPEG (writing to
  the photo-control characteristic sets the capture interval). Image rotation depends on the
  firmware version (see `compareVersions`).
- **Audio / transcription**: accumulates the Opus stream into ~10 s segments. Each segment is
  appended to a per-session concatenated Ogg/Opus file (`AudioSession`) via the incremental writer
  in `modules/audio.ts`, staged durably as a `PendingTranscription` record + standalone segment
  Ogg (`audio/pending/`), and transcribed by `transcribe()` (`modules/llm`, which resolves the
  provider from `Settings.audio.transcriptionModel`) with the text and the actual model ref stored
  on its `AudioChunk`; on success the pending record/file are deleted, on failure or app kill they
  survive and `resumePendingTranscriptions()` (`modules/transcriptionBacklog.ts`) re-runs them —
  automatically at launch (`DeviceProvider`) and via the resume banner on `/transcript`. Corrupt
  frames (Opus TOC code ≠ 0, from rare BLE glitches) are dropped before muxing or playback breaks.
  The `/transcript` screen renders a day's sessions with an audio player (Android/Web only — iOS
  can't decode Ogg/Opus) and the per-segment transcript. Sync and the transcription queue signal
  `modules/backgroundWork.ts` so `useDeviceKeepAlive` keeps the Android foreground service up
  (with state-aware notification text) until the work drains, even after BLE disconnects.

## LLM clients

`src/modules/llm/` is the common inference abstraction: a `task` (`transcription` / `text` /
`vision`) resolves to a `cloud` or `local` provider behind a shared interface. `catalog.ts` is the
single source of truth for the selectable models (used by both the settings UI and the resolver);
`registry.ts` exposes `transcribe()` (reads `Settings.audio.transcriptionModel`), `generateText()`
(reads `Settings.summary.model`), and `getVisionProvider()`, each falling back to the cloud
default when the chosen provider is unavailable (and only if the corresponding `cloudFallback`
setting allows it — `cloudFallback: false` means "never send this data off-device"). The cloud
Groq providers live in `transcription/groq.ts` and `text/groq.ts` / `vision/groq.ts` (both Llama 4
Scout via the shared `groqChat.ts`). The Groq API key is resolved by `groqKey.ts`: the key saved
on the Device screen (SecureStore) wins over the `EXPO_PUBLIC_GROQ_API_KEY` env var. Local
inference (transcription **and** text generation) shares one LiteRT engine/model instance and is
serialized through `localQueue.ts`. **Vision is cloud-only**: the `react-native-litert-lm` patch
drops `visionBackend`, so local Gemma cannot take image input.

On-device STT (`transcription/whisperLocal.ts`) runs via **LiteRT-LM** (`react-native-litert-lm`,
Google AI Edge runtime) with **Gemma 4 E2B** (a multimodal model — audio → text). On Android it uses
the OpenCL GPU delegate (Pixel devices; Samsung/Qualcomm typically lack OpenCL → falls back to CPU),
on iOS Metal. We chose this after whisper.rn (Android GPU is iOS-only → CPU-slow) and Cactus
(`cactus-react-native` requires nitro 0.33, incompatible with the nitro 0.35 that MMKV/Unistyles need
on RN 0.83) both proved unworkable — see git history.

Pipeline (platform-split engine, BLE-style dynamic import in `whisper/index.ts`;
`engine.native.ts` = LiteRT, `engine.web.ts` = stub): the device streams Opus, but iOS can't
decode Ogg/Opus at the OS level — so `engine.native.ts` decodes Ogg→PCM with
`react-native-audio-api`'s `decodeAudioData`, converts it to **raw 16 kHz mono 16-bit PCM**
(`floatToPcm16`, no WAV header), and passes it as a zero-copy `ArrayBuffer` via
`llm.sendMultimodalMessage([{type:'audio', audioBuffer}, {type:'text', text: prompt}])`
(LiteRT `Content.AudioBytes`). We use raw PCM bytes, **not** a WAV file path
(`sendMessageWithAudio`/`Content.AudioFile`): with Gemma 4 E2B the WAV-file path failed at prefill
with `Failed to allocate tensors (RunPrefillAsync)`. The other half of that fix is `maxTokens:
4096` in `loadModel` (LiteRT `maxNumTokens` is the *input+output* budget; the wrapper default of
1024 is too small for audio-token prefill — Gemma 4 E2B's audio executor is bundled in the
`.litertlm` and loaded on demand). The `react-native-litert-lm@0.4.2` patch
(`patches/`) drops `visionBackend` so audio-only multimodal init doesn't depend on OpenCL. **This
Gemma-4-on-GPU path is unverified on a real Pixel — see issue #66** (acceptance needs Android 16
QPR3 / PowerVR driver v25.1); until confirmed, `transcribe()` falls back to cloud Groq. The Gemma model
(`gemma-4-e2b`, ~2.6 GB) is **not bundled** — LiteRT downloads it on first use (`downloadModel`,
cached), and readiness is tracked by storing the downloaded file's absolute path in MMKV
(`litert:model-path:<id>`) and checking the file still exists, since there's no public exists-check
(a bare flag desyncs if the cache is cleared). Until downloaded (or on non-GPU devices where you may prefer cloud),
`isAvailable()` is false and `transcribe()` falls back to cloud, so the pipeline never stalls.
Backend selection (`pickBackend`): always **attempt GPU first** (Metal on iOS, OpenCL on Android),
then fall back to CPU on the first failure and stick to CPU for the session (`forceCpu`). We do
**not** gate on `checkBackendSupport('gpu')` — on Android it's a static advisory that always warns
regardless of device, so it would pin even Pixels to CPU; the real OpenCL probe lives in the native
`loadModel`, and the fallback in `transcribeFile` catches both load-time and inference-time GPU
failures. Local transcription is serialized (one segment at a time) with bounded retry. Native deps
(`react-native-litert-lm`, `react-native-audio-api`, `react-native-worklets`) require an
`expo prebuild` + EAS dev build rebuild; the `react-native-litert-lm` config plugin sets Android
minSdk 26 / Kotlin, and `react-native-worklets/plugin` must be the last Babel plugin.

Caveats: Gemma "reasons over" audio rather than being a pure ASR, so transcription is prompt-driven
(`transcriptionPrompt()` in `engine.native.ts`) and verbatim accuracy/latency for Japanese must be
verified on-device — adjust the prompt or model (E4B) if needed. Gemma 4 E2B needs ~4 GB+ RAM.

The legacy clients `openai` / `ollama` still live directly under `src/modules/` and are slated to
migrate into `modules/llm/` (`groq-llama3` was already replaced by the `text` / `vision` tasks).
API keys are read from `EXPO_PUBLIC_*` environment variables via `src/keys.ts` (`.env` is
gitignored; note that the `EXPO_PUBLIC_` prefix means the value is embedded into the client
bundle).

## AI summaries (`src/modules/summary/`)

`generateDaySummary(date, onProgress)` builds the per-day AI summary (issues #13 / #18 / #32) as a
map-reduce: representative photos (non-blurry, evenly spaced, max 8) get cloud-vision descriptions
cached onto `Photo.description`; each `AudioSession`'s transcript (excerpted to a char budget —
small for local Gemma's 4096-token window) is summarized into a `SessionSummary`; then one final
`text` call writes the first-person diary (`DaySummary`, stored at `summary:{date}`,
read reactively via `useDaySummary`). The UI lives in `components/DaySummarySection.tsx`
(Journal modal); model + cloud-fallback settings are on the Device screen
(`Settings.summary`).

## Design system (`src/ui/`)

Themes are built on Unistyles v3 using tokens from the Digital Agency Design System (DADS).

- `pnpm tokens` converts `@digital-go-jp/design-tokens` (which is CSS-oriented) into RN tokens and
  **generates** `theme/tokens.generated.ts`. Never edit that file by hand.
- A theme is the composition of `colors` (swappable semantic colors) and `shared` (typography /
  spacing / radius / elevation — fixed by DADS) — see `theme/themes.ts`.
- Components (`ui/components/`) reference only `theme.colors.*` semantic roles and never hard-code
  hex color literals. `scripts/check-no-color-literals.mjs` enforces this in the pre-commit hook
  (background: GitHub issue #50).
- App code must import components through the entry point (`ui/index.ts`).
