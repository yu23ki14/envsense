/**
 * Button — DADS のボタン。
 *
 * Pressable ベース。variant でスタイル（塗り / アウトライン / テキスト）、
 * size でサイズ、状態（pressed / disabled / loading）を扱う。
 * ラベルは Text コンポーネントで描画する。
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { ColorScheme } from '../../theme/semantic';
import { Text } from '../Text';

export type ButtonVariant = 'solid' | 'outline' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** ラベル左のアイコンスロット */
  iconLeft?: ReactNode;
  /** ラベル右のアイコンスロット */
  iconRight?: ReactNode;
  children: ReactNode;
};

/** 最小タップ領域 44 を満たす size 別の高さ */
const HEIGHT: Record<ButtonSize, number> = { sm: 44, md: 52, lg: 60 };

/** コンテナ（背景・枠線）の色を variant と状態から決める */
function containerColors(
  colors: ColorScheme,
  variant: ButtonVariant,
  state: { pressed: boolean; disabled: boolean },
): { backgroundColor: string; borderColor: string } {
  if (variant === 'solid') {
    if (state.disabled) {
      return { backgroundColor: colors.primaryDisabled, borderColor: colors.primaryDisabled };
    }
    const bg = state.pressed ? colors.primaryHover : colors.primary;
    return { backgroundColor: bg, borderColor: bg };
  }
  const backgroundColor = state.pressed ? colors.surfaceMuted : 'transparent';
  if (variant === 'text') {
    return { backgroundColor, borderColor: 'transparent' };
  }
  return { backgroundColor, borderColor: state.disabled ? colors.border : colors.primary };
}

/** ラベル・アイコン・スピナーの前景色 */
function contentColor(colors: ColorScheme, variant: ButtonVariant, disabled: boolean): string {
  if (disabled) {
    return colors.textDisabled;
  }
  return variant === 'solid' ? colors.onPrimary : colors.primary;
}

export function Button({
  variant = 'solid',
  size = 'md',
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  children,
  ...rest
}: ButtonProps) {
  const { theme } = useUnistyles();
  const isDisabled = disabled || loading;
  const foreground = contentColor(theme.colors, variant, isDisabled);

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        height: HEIGHT[size],
        paddingHorizontal: size === 'sm' ? theme.spacing.md : theme.spacing.lg,
        borderWidth: 1,
        borderRadius: theme.radius[8],
        ...containerColors(theme.colors, variant, {
          pressed: pressed && !isDisabled,
          disabled: isDisabled,
        }),
      })}
    >
      {loading ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <>
          {iconLeft}
          <Text variant="label" weight="bold" numberOfLines={1} style={{ color: foreground }}>
            {children}
          </Text>
          {iconRight}
        </>
      )}
    </Pressable>
  );
}
