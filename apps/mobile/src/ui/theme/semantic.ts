/**
 * カラーロール層（セマンティックカラー）。
 *
 * コンポーネントはこの `ColorScheme` のロールのみを参照し、primitive カラーや
 * 色リテラルを直接使わない。これにより「色だけ」を差し替えてテーマを
 * カスタマイズできる。設計方針: GitHub issue #50「カラーテーマのカスタマイズ」。
 */
import { tokens } from './tokens.generated';

/** 単一色相のカラースケール（例: { 50: '#...', 100: '#...' }） */
export type ColorScale = Record<string, string>;

/**
 * `createColors` が消費する primitive カラー入力。
 * 既定は DADS パレット（`defaultPalette`）。
 * 独自ブランド色にする場合は、同じ形のオブジェクトを渡す。
 */
export type Palette = {
  /** ブランド / プライマリのカラースケール（既定: DADS Blue） */
  brand: ColorScale;
  /** 中立グレースケール（既定: DADS SolidGray） */
  gray: ColorScale;
  white: string;
  black: string;
  /** 黒の不透明度スケール（オーバーレイ用、既定: DADS OpacityGray） */
  overlay: ColorScale;
  /** 成功色スケール（既定: DADS Semantic Success） */
  success: ColorScale;
  /** エラー色スケール（既定: DADS Semantic Error） */
  error: ColorScale;
  /** 警告色スケール（既定: DADS Semantic Warning / Yellow） */
  warning: ColorScale;
};

/** DADS の primitive トークンから構築した既定パレット */
export const defaultPalette: Palette = {
  brand: tokens.color.primitive.blue,
  gray: tokens.color.neutral.solidGray,
  white: tokens.color.neutral.white,
  black: tokens.color.neutral.black,
  overlay: tokens.color.neutral.opacityGray,
  success: tokens.color.semantic.success,
  error: tokens.color.semantic.error,
  warning: tokens.color.semantic.warning.yellow,
};

/**
 * コンポーネントが参照するカラーロールの契約。
 * ロールの抜け漏れは型エラーで検出される。
 */
export type ColorScheme = {
  // ブランド / アクション
  primary: string;
  primaryHover: string;
  primaryDisabled: string;
  onPrimary: string;
  // テキスト
  text: string;
  textMuted: string;
  textDisabled: string;
  link: string;
  // 背景・面
  background: string;
  surface: string;
  surfaceMuted: string;
  // 境界
  border: string;
  borderStrong: string;
  // フィードバック
  success: string;
  error: string;
  errorHover: string;
  onError: string;
  warning: string;
  // フォーカス・状態
  focusRing: string;
  overlay: string;
};

/** #RGB / #RRGGBB → [r, g, b] */
function hexToRgb(hex: string): number[] {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : normalized;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x の相対輝度 */
function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** 2 色のコントラスト比（1〜21） */
function contrastRatio(a: string, b: string): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 背景色に対しコントラストの高い前景色を返す。
 * 独自色に差し替えた際の WCAG コントラスト担保を補助する。
 */
function pickForeground(background: string, light: string, dark: string): string {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/**
 * パレットからカラーロールを算出する純粋関数。
 * 別パレットを渡すだけで「色だけ」差し替えられる。
 */
export function createColors(palette: Palette): ColorScheme {
  const primary = palette.brand['900'];
  const error = palette.error['1'];
  return {
    primary,
    primaryHover: palette.brand['1000'],
    primaryDisabled: palette.gray['200'],
    onPrimary: pickForeground(primary, palette.white, palette.gray['900']),

    text: palette.gray['900'],
    textMuted: palette.gray['700'],
    textDisabled: palette.gray['400'],
    link: palette.brand['900'],

    background: palette.white,
    surface: palette.white,
    surfaceMuted: palette.gray['50'],

    border: palette.gray['300'],
    borderStrong: palette.gray['600'],

    success: palette.success['1'],
    error,
    errorHover: palette.error['2'],
    onError: pickForeground(error, palette.white, palette.gray['900']),
    warning: palette.warning['1'],

    focusRing: palette.brand['700'],
    overlay: palette.overlay['500'],
  };
}

/** 既定（DADS パレット）のカラースキーム */
export const colors: ColorScheme = createColors(defaultPalette);
