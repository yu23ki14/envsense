/**
 * Select — DADS のセレクト（ドロップダウン）。
 *
 * トリガーは入力欄ライクな見た目。選択肢は RN の Modal でリスト表示し、
 * トークンで装飾する（追加のネイティブ依存なし）。
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '../Text';

export type SelectOption<T extends string> = { label: string; value: T };

export type SelectProps<T extends string> = {
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  label?: string;
  helpText?: string;
  errorText?: string;
  disabled?: boolean;
};

export function Select<T extends string>({
  options,
  value,
  onChange,
  placeholder = '選択してください',
  label,
  helpText,
  errorText,
  disabled = false,
}: SelectProps<T>) {
  const { theme } = useUnistyles();
  const { colors } = theme;
  const [open, setOpen] = useState(false);
  const hasError = errorText != null && errorText !== '';
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <View style={{ gap: theme.spacing.xxs }}>
      {label != null && <Text variant="label">{label}</Text>}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 48,
          paddingHorizontal: theme.spacing.sm,
          borderWidth: 1,
          borderColor: hasError ? colors.error : colors.border,
          borderRadius: theme.radius[8],
          backgroundColor: disabled ? colors.surfaceMuted : colors.surface,
        }}
      >
        <Text
          variant="body"
          color={disabled ? 'textDisabled' : selected ? 'text' : 'textMuted'}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <View
          style={{
            width: 8,
            height: 8,
            borderRightWidth: 2,
            borderBottomWidth: 2,
            borderColor: disabled ? colors.textDisabled : colors.textMuted,
            transform: [{ rotate: '45deg' }],
            marginTop: -4,
          }}
        />
      </Pressable>

      {hasError ? (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      ) : helpText != null ? (
        <Text variant="caption" color="textMuted">
          {helpText}
        </Text>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: colors.overlay,
            justifyContent: 'center',
            padding: theme.spacing.lg,
          }}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              backgroundColor: colors.surface,
              borderRadius: theme.radius[12],
              maxHeight: '70%',
              overflow: 'hidden',
            }}
          >
            <ScrollView>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={{
                      paddingVertical: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.lg,
                      backgroundColor: isSelected ? colors.surfaceMuted : colors.surface,
                    }}
                  >
                    <Text variant="body" color={isSelected ? 'link' : 'text'}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
