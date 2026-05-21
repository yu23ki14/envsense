/**
 * Radio / RadioGroup — DADS のラジオボタン。
 *
 * Radio は単体でも使え、RadioGroup は options から複数の Radio を描画し
 * 単一選択を管理する。
 */
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '../Text';

const OUTER_SIZE = 24;

export type RadioProps = {
  selected: boolean;
  onPress?: () => void;
  label?: string;
  disabled?: boolean;
};

export function Radio({ selected, onPress, label, disabled = false }: RadioProps) {
  const { theme } = useUnistyles();
  const { colors } = theme;
  const ringColor = disabled ? colors.border : selected ? colors.primary : colors.borderStrong;
  const dotColor = disabled ? colors.textDisabled : colors.primary;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        minHeight: 44,
      }}
    >
      <View
        style={{
          width: OUTER_SIZE,
          height: OUTER_SIZE,
          borderRadius: OUTER_SIZE / 2,
          borderWidth: 2,
          borderColor: ringColor,
          backgroundColor: disabled ? colors.surfaceMuted : colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dotColor }} />
        )}
      </View>
      {label != null && (
        <Text variant="body" color={disabled ? 'textDisabled' : 'text'}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export type RadioOption<T extends string> = { label: string; value: T };

export type RadioGroupProps<T extends string> = {
  options: RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  label?: string;
};

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  label,
}: RadioGroupProps<T>) {
  const { theme } = useUnistyles();

  return (
    <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.xs }}>
      {label != null && <Text variant="label">{label}</Text>}
      {options.map((option) => (
        <Radio
          key={option.value}
          selected={option.value === value}
          disabled={disabled}
          label={option.label}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}
