/**
 * ModalPlaceholder — モーダル表示する画面（日別ジャーナル / エクスポート）の仮コンテンツ。
 *
 * 戻る導線つきのヘッダーと仮の本文を表示する。各画面の実装 Issue で本物に差し替える。
 */
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '../ui';

export type ModalPlaceholderProps = {
  title: string;
  description?: string;
};

export function ModalPlaceholder({ title, description }: ModalPlaceholderProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.xs }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          onPress={() => router.back()}
          style={styles.back}
        >
          <ChevronLeft size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text variant="heading2">{title}</Text>
        {description ? (
          <Text variant="body" color="textMuted" style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xs,
    paddingBottom: theme.spacing.xs,
  },
  back: {
    padding: theme.spacing.xs,
  },
  body: {
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
