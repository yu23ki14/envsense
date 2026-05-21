/**
 * TextField — DADS の入力テキスト。
 *
 * TextInput ベース。ラベル / 補足テキスト / エラーテキストのスロットを持ち、
 * default / focused / error / disabled の状態を扱う。
 * placeholder / keyboardType / secureTextEntry 等は素通しする。
 */
import { useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { ColorScheme } from '../../theme/semantic';
import { Text } from '../Text';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'editable'> & {
  label?: string;
  /** 入力欄下の補足テキスト（エラー時はエラーテキストを優先表示） */
  helpText?: string;
  errorText?: string;
  required?: boolean;
  disabled?: boolean;
};

/** 枠線色を状態から決める（disabled > error > focused > default） */
function borderColor(
  colors: ColorScheme,
  state: { disabled: boolean; hasError: boolean; focused: boolean },
): string {
  if (state.disabled) {
    return colors.border;
  }
  if (state.hasError) {
    return colors.error;
  }
  if (state.focused) {
    return colors.focusRing;
  }
  return colors.border;
}

export function TextField({
  label,
  helpText,
  errorText,
  required = false,
  disabled = false,
  onFocus,
  onBlur,
  accessibilityLabel,
  ...rest
}: TextFieldProps) {
  const { theme } = useUnistyles();
  const [focused, setFocused] = useState(false);
  const hasError = errorText != null && errorText !== '';

  return (
    <View style={{ gap: theme.spacing.xxs }}>
      {label != null && (
        <Text variant="label">
          {label}
          {required && (
            <Text variant="label" color="error">
              {' '}
              ※
            </Text>
          )}
        </Text>
      )}

      <TextInput
        {...rest}
        accessibilityLabel={accessibilityLabel ?? (required ? `${label}（必須）` : label)}
        editable={!disabled}
        placeholderTextColor={theme.colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={{
          height: 48,
          paddingHorizontal: theme.spacing.sm,
          borderWidth: focused || hasError ? 2 : 1,
          borderColor: borderColor(theme.colors, { disabled, hasError, focused }),
          borderRadius: theme.radius[8],
          backgroundColor: disabled ? theme.colors.surfaceMuted : theme.colors.surface,
          color: disabled ? theme.colors.textDisabled : theme.colors.text,
          fontSize: theme.typography.fontSize[16],
          fontFamily: theme.typography.fontFamily.sans[400],
        }}
      />

      {hasError ? (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      ) : helpText != null ? (
        <Text variant="caption" color="textMuted">
          {helpText}
        </Text>
      ) : null}
    </View>
  );
}
