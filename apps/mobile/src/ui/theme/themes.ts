/**
 * Unistyles のテーマ定義。
 *
 * テーマは `colors`（差し替え対象）と `shared`（typography / spacing /
 * radius / elevation — DADS 固定）を合成して構築する。
 * 独自ブランド色にするときは `colors` のみ差し替える（issue #50 参照）。
 */
import { colors } from './semantic';
import { spacing } from './spacing';
import { tokens } from './tokens.generated';

/** 色以外のトークン。テーマ間で共有し、カスタマイズ対象外とする。 */
const shared = {
  spacing,
  radius: tokens.borderRadius,
  elevation: tokens.elevation,
  typography: {
    fontSize: tokens.fontSize,
    lineHeight: tokens.lineHeight,
    fontWeight: tokens.fontWeight,
    fontFamily: tokens.fontFamily,
  },
} as const;

/** 既定（DADS パレット）のライトテーマ */
export const lightTheme = {
  colors,
  ...shared,
} as const;

export const themes = {
  light: lightTheme,
} as const;

export type AppTheme = typeof lightTheme;
