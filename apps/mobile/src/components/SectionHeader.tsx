/**
 * SectionHeader — セクションの見出し（小ラベル + 見出し + 任意アクション）。
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '../ui';

export type SectionHeaderProps = {
  /** 見出し上の小ラベル。 */
  kicker?: string;
  title: string;
  /** 右端のアクションスロット。 */
  action?: ReactNode;
};

export function SectionHeader({ kicker, title, action }: SectionHeaderProps) {
  return (
    <View style={styles.root}>
      <View style={styles.texts}>
        {kicker ? (
          <Text variant="caption" color="textMuted">
            {kicker}
          </Text>
        ) : null}
        <Text variant="heading3">{title}</Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  texts: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
}));
