/**
 * Checkbox — DADS のチェックボックス。
 *
 * Pressable ベース。checked / indeterminate / disabled を扱う。
 * チェックマークはフォント非依存のため View で描画する。
 */
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '../Text';

export type CheckboxProps = {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  indeterminate?: boolean;
  disabled?: boolean;
};

const BOX_SIZE = 24;

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled = false,
}: CheckboxProps) {
  const { theme } = useUnistyles();
  const { colors } = theme;
  const active = checked || indeterminate;

  const boxColor = disabled ? colors.surfaceMuted : active ? colors.primary : colors.surface;
  const frameColor = disabled ? colors.border : active ? colors.primary : colors.borderStrong;
  const markColor = disabled ? colors.textDisabled : colors.onPrimary;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled }}
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        minHeight: 44,
      }}
    >
      <View
        style={{
          width: BOX_SIZE,
          height: BOX_SIZE,
          borderWidth: 2,
          borderColor: frameColor,
          borderRadius: theme.radius[4],
          backgroundColor: boxColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {indeterminate ? (
          <View style={{ width: 12, height: 2, backgroundColor: markColor }} />
        ) : checked ? (
          <View
            style={{
              width: 7,
              height: 12,
              borderRightWidth: 2,
              borderBottomWidth: 2,
              borderColor: markColor,
              transform: [{ rotate: '45deg' }],
              marginTop: -2,
            }}
          />
        ) : null}
      </View>
      {label != null && (
        <Text variant="body" color={disabled ? 'textDisabled' : 'text'}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
