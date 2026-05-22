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

The entry point is `index.ts` → `App`. `index.ts` imports `src/ui/unistyles` **before anything
else**, because Unistyles' `StyleSheet.configure` must run before any `StyleSheet.create` call.
Breaking this import order crashes the app with an unconfigured theme.

## Screen flow

`Main.tsx` manages the BLE connection via `useDevice()` and renders `DeviceView` once connected.
`useDevice` saves the last-connected device ID to AsyncStorage and tries to auto-reconnect on
startup (falling back to a manual scan on failure).

## BLE layer (`src/modules/ble/`)

Platform separation is essential. The `BleClient` interface in `types.ts` is implemented by
`ble.native.ts` (react-native-ble-plx) and `ble.web.ts` (Web Bluetooth); `index.ts` picks one via
a **dynamic import** based on `Platform.OS`. This keeps the native bridge out of the web bundle
and the Web Bluetooth references out of the native bundle. **Always write BLE features against
this abstraction** (`BleClient` / `BleDevice` / `BleService` / `BleCharacteristic`) — never call
platform-specific APIs directly.

The UUIDs and packet formats must match the firmware (`firmware/src/config.h`).

## Device integration pipeline

- **Photos**: `DeviceView` subscribes to the envsense GATT service's photo characteristics and
  reassembles the chunked JPEG (writing to the photo-control characteristic triggers automatic
  capture every 5 seconds). Image rotation behavior depends on the firmware version (see
  `compareVersions`).
- **Transcription**: `useTranscripts` subscribes to the Opus audio stream and sends ~10-second
  segments to Groq Whisper wrapped as Ogg/Opus. There is no WASM Opus decoder — only Ogg wrapping
  — so the same path works on web and native.
- **Agent** (`src/agent/`): accumulates photo descriptions (Groq Vision) and answers questions
  with Groq Llama. `Agent.use()` is a class method but is called as a React hook from a
  component's render.

## LLM clients

`src/modules/` contains `groq-llama3` / `openai` / `ollama` / `whisper`. API keys are read from
`EXPO_PUBLIC_*` environment variables via `src/keys.ts` (`.env` is gitignored; note that the
`EXPO_PUBLIC_` prefix means the value is embedded into the client bundle).

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
