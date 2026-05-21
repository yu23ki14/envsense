/**
 * Text — DADS のタイプスケールに沿ったテキストコンポーネント。
 *
 * React Native の `Text` の薄いラッパー。`variant` でサイズと行間、`weight`
 * で太さ、`color` でセマンティックカラーを指定する。行間はトークンの比率 ×
 * fontSize で算出する。`allowFontScaling` は無効化しないため、端末のフォント
 * サイズ設定に追従する。
 */
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { StyleSheet, type UnistylesVariants } from 'react-native-unistyles';

const styles = StyleSheet.create((theme) => {
  const { fontSize, lineHeight, fontFamily, fontWeight } = theme.typography;

  /** DADS テキストスタイル: サイズと行間（fontSize × 比率）を組み立てる */
  const scale = (size: number, ratio: number) => ({
    fontSize: size,
    lineHeight: size * ratio,
  });

  const normal = { fontFamily: fontFamily.sans[400], fontWeight: fontWeight[400] };
  const bold = { fontFamily: fontFamily.sans[700], fontWeight: fontWeight[700] };

  return {
    text: {
      variants: {
        // variant はサイズ・行間と既定ウェイトを持つ完結したテキストスタイル。
        // 行間は DADS の原則どおり、大きい文字ほど狭める。
        variant: {
          display: { ...scale(fontSize[48], lineHeight[140]), ...bold },
          heading1: { ...scale(fontSize[32], lineHeight[140]), ...bold },
          heading2: { ...scale(fontSize[28], lineHeight[140]), ...bold },
          heading3: { ...scale(fontSize[24], lineHeight[140]), ...bold },
          heading4: { ...scale(fontSize[20], lineHeight[140]), ...bold },
          bodyLarge: { ...scale(fontSize[17], lineHeight[170]), ...normal },
          body: { ...scale(fontSize[16], lineHeight[175]), ...normal },
          label: { ...scale(fontSize[16], lineHeight[130]), ...normal },
          caption: { ...scale(fontSize[14], lineHeight[140]), ...normal },
        },
        // weight は variant の既定ウェイトを上書きする（未指定なら variant のまま）。
        weight: {
          normal,
          bold,
        },
        color: {
          text: { color: theme.colors.text },
          textMuted: { color: theme.colors.textMuted },
          textDisabled: { color: theme.colors.textDisabled },
          link: { color: theme.colors.link },
          onPrimary: { color: theme.colors.onPrimary },
          onError: { color: theme.colors.onError },
          error: { color: theme.colors.error },
          success: { color: theme.colors.success },
          warning: { color: theme.colors.warning },
        },
      },
    },
  };
});

type TextVariant = NonNullable<UnistylesVariants<typeof styles>['variant']>;

/** `accessibilityRole="header"` を自動付与する見出し系 variant */
const HEADING_VARIANTS = new Set<TextVariant>([
  'display',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
]);

export type TextProps = RNTextProps & UnistylesVariants<typeof styles>;

export function Text({
  variant = 'body',
  weight,
  color = 'text',
  style,
  accessibilityRole,
  ...rest
}: TextProps) {
  styles.useVariants({ variant, weight, color });

  return (
    <RNText
      {...rest}
      accessibilityRole={
        accessibilityRole ?? (HEADING_VARIANTS.has(variant) ? 'header' : undefined)
      }
      style={[styles.text, style]}
    />
  );
}
