/**
 * Tag — 小さなピル型ラベル（#タグ や統計チップに使う）。
 */
import { View } from 'react-native';
import { StyleSheet, type UnistylesVariants } from 'react-native-unistyles';
import { Text } from '../ui';

const styles = StyleSheet.create((theme) => ({
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radius[8],
    variants: {
      tone: {
        neutral: { backgroundColor: theme.colors.surfaceMuted },
        primary: { backgroundColor: theme.colors.primary },
      },
    },
  },
}));

export type TagProps = UnistylesVariants<typeof styles> & {
  label: string;
};

export function Tag({ label, tone = 'neutral' }: TagProps) {
  styles.useVariants({ tone });

  return (
    <View style={styles.tag}>
      <Text variant="caption" color={tone === 'primary' ? 'onPrimary' : 'textMuted'}>
        {label}
      </Text>
    </View>
  );
}
