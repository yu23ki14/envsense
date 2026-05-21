/**
 * スペーシングスケール（4px グリッド）。
 *
 * DADS のトークンパッケージ（`@digital-go-jp/design-tokens`）には spacing が
 * 含まれない（DADS の spacing は Tailwind プラグイン側で提供される）ため、
 * 4px グリッドに沿ったスケールを独自定義する。
 */
export const spacing = {
  none: 0,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  xxxl: 48,
} as const;

export type Spacing = typeof spacing;
export type SpacingKey = keyof Spacing;
