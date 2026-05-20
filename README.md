# envsense

ウェアラブルな環境センシングデバイスのためのモノレポ。
[omiGlass](https://github.com/BasedHardware/omiGlass) を出発点に、XIAO ESP32S3 Sense を使った
写真 + 音声キャプチャ端末と、そのコンパニオンモバイルアプリを開発する。

> このリポジトリは omiGlass（MIT License）から派生しています。詳細は [`LICENSE`](./LICENSE) を参照。

## モノレポ構成

```
envsense/
├── apps/
│   └── mobile/        # Expo SDK 55 モバイルアプリ (iOS / Android)
├── firmware/          # ESP32 ファームウェア (PlatformIO) — #35
├── hardware/          # クリップ筐体 (OpenSCAD) — #2
├── docs/              # 設計ドキュメント
├── pnpm-workspace.yaml
└── package.json
```

omiGlass のコード移行は #36〜#41 で行う。現時点で `apps/mobile` は空の Expo プロジェクト枠。

## 必要環境

- Node.js >= 20
- pnpm 10（`corepack enable` 推奨）
- iOS / Android 実機、または各シミュレータ・Expo Go アプリ

## セットアップ

```bash
pnpm install
```

`pnpm install` 完了時に lefthook の pre-commit フックも自動でセットアップされる。

## モバイルアプリの起動

```bash
pnpm start            # = expo start（apps/mobile）
pnpm ios              # iOS シミュレータ
pnpm android          # Android エミュレータ
```

`pnpm mobile <script>` で `apps/mobile` の任意のスクリプトを実行できる。

## コード品質

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | Biome による lint + format（自動修正） |
| `pnpm lint` | Biome lint |
| `pnpm format` | Biome format |
| `pnpm typecheck` | `tsc --noEmit` |

pre-commit フック（lefthook）が、ステージされたファイルに対し Biome（lint + format）と
`tsc` のコンパイルチェックを自動実行する。

## EAS（オーナー作業）

`apps/mobile/eas.json` は用意済みだが、`projectId` の発行には Expo アカウントが必要。
リポジトリオーナーが以下を実行すると、`apps/mobile/app.json` に `extra.eas.projectId`
が自動で追記される。

```bash
cd apps/mobile
pnpm eas login
pnpm eas init
```

`eas-cli` は `apps/mobile` の devDependency。`apps/mobile` 配下で `pnpm eas <command>`、
ルートからは `pnpm mobile eas <command>` で実行できる。

## ライセンス

MIT License — omiGlass 由来。[`LICENSE`](./LICENSE) を参照。
