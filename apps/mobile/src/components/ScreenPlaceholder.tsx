/**
 * ScreenPlaceholder — 画面本体が未実装のタブで表示する仮コンテンツ。
 *
 * 各画面の実装 Issue（今日 / 記録 / デバイス）で本物の画面に差し替える。
 */
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button, Text } from '../ui';

export type ScreenPlaceholderProps = {
  title: string;
  description?: string;
  /** 任意のアクションボタン（例: モーダルを開く導線）。 */
  actionLabel?: string;
  onAction?: () => void;
};

export function ScreenPlaceholder({
  title,
  description,
  actionLabel,
  onAction,
}: ScreenPlaceholderProps) {
  return (
    <View style={styles.root}>
      <Text variant="heading1">{title}</Text>
      {description ? (
        <Text variant="body" color="textMuted" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="outline" onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  description: {
    textAlign: 'center',
  },
}));
