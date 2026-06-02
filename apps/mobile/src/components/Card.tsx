/**
 * Card — 角丸・境界・面色をもつサーフェスコンテナ。
 *
 * `tone` で通常面（default）と弱い面（soft）を切り替える。`onPress` を渡すと
 * 押下可能なカードになる。
 */
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';
import { StyleSheet, type UnistylesVariants } from 'react-native-unistyles';

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.radius[12],
    variants: {
      tone: {
        plain: {
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        soft: {
          backgroundColor: theme.colors.surfaceMuted,
        },
      },
      padding: {
        none: { padding: theme.spacing.none },
        sm: { padding: theme.spacing.sm },
        md: { padding: theme.spacing.md },
        lg: { padding: theme.spacing.lg },
      },
    },
  },
}));

export type CardProps = UnistylesVariants<typeof styles> & {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function Card({ tone = 'plain', padding = 'md', children, onPress, style }: CardProps) {
  styles.useVariants({ tone, padding });

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={[styles.card, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}
