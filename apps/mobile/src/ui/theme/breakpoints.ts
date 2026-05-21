/**
 * Unistyles のブレークポイント。
 * モバイル単独構成のため最小限。`xs` は値 0 で必須。
 */
export const breakpoints = {
  xs: 0,
  sm: 360,
  md: 768,
  lg: 1024,
} as const;

export type Breakpoints = typeof breakpoints;
