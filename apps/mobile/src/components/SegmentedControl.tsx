/**
 * SegmentedControl — セグメント切り替えコントロール。
 *
 * 値は呼び出し側が保持する制御コンポーネント。
 */
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '../ui';

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              variant="caption"
              weight={active ? 'bold' : 'normal'}
              color={active ? 'text' : 'textMuted'}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: {
    flexDirection: 'row',
    gap: theme.spacing.xxs,
    padding: theme.spacing.xxs,
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius[8],
  },
  segmentActive: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
