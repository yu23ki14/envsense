# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

envsense is a wearable AI-agent device with various onboard sensors. Derived from
[omiGlass](https://github.com/BasedHardware/omiGlass) (MIT), it is a pnpm monorepo containing a
photo + audio capture device built on the XIAO ESP32S3 Sense and its companion mobile app.

## Workspace layout

| Directory | Contents | Child CLAUDE.md |
| --- | --- | --- |
| `apps/mobile/` | Expo SDK 55 mobile app (iOS / Android / web) | yes |
| `firmware/` | ESP32-S3 firmware (Arduino, built with arduino-cli) | yes |
| `hardware/` | Clip enclosure (parametric OpenSCAD design) | yes |
| `docs/` | Design documents | — |

Only `apps/*` is part of the pnpm workspace. `firmware` and `hardware` live outside the Node
workspace and use their own toolchains (arduino-cli / OpenSCAD). When working in any of these
directories, always read that directory's child CLAUDE.md as well.

## Root commands

`pnpm install` also sets up the lefthook pre-commit hooks.

| Command | Description |
| --- | --- |
| `pnpm start` / `pnpm ios` / `pnpm android` / `pnpm web` | Launch the mobile app |
| `pnpm typecheck` | `tsc --noEmit` for `apps/mobile` |
| `pnpm check` | Biome lint + format (auto-fix) |
| `pnpm lint` / `pnpm format` | Biome individually |
| `pnpm mobile <script>` | Run any `apps/mobile` script |

There is no automated test runner yet.

## Cross-cutting concerns

### The BLE protocol is shared by firmware and app

The device and app communicate over BLE GATT. They use an envsense-specific 128-bit UUID series
(base `EA80xxxx-9C72-497F-81F9-752FFE11F565`), deliberately kept distinct from the OMI/Friend
protocol. **The UUIDs and packet formats will break unless you change both the firmware
(`firmware/src/config.h`) and the app (`apps/mobile/src/modules/`) together.** config.h is the
source of truth.

### node_modules is hoisted

Expo/Metro autolinking does not fully support pnpm's symlinked layout, so `nodeLinker: hoisted`
is set in both `pnpm-workspace.yaml` and `.npmrc`. Never change just one of them.

### Code style

- JS/TS uses Biome (`biome.json`): single quotes / semicolons / trailing commas everywhere /
  line width 100 / 2-space indent.
- C/C++ uses `firmware/.clang-format` (LLVM-based, indent 4, line width 120).
- The pre-commit hook (`lefthook.yml`) runs Biome, `tsc`, and the design-system color-literal check.
- Commit messages follow Conventional Commits (Japanese body). Examples: `feat(mobile): …`,
  `docs(firmware): …`.

### License

MIT, inherited from omiGlass.
