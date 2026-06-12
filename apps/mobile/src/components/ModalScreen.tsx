/**
 * ModalScreen — モーダル表示する画面（日別ジャーナル / エクスポート）の共通シェル。
 *
 * 戻るボタン付きのヘッダーと、スクロール可能な本文領域を提供する。タブ画面の
 * ClipScreen と対になる存在で、画面側はここに子要素を流し込むだけでよい。
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Icon, Text } from '../ui';

export type ModalScreenProps = {
  title: string;
  /** タイトル下の補足テキスト。 */
  subtitle?: string;
  /** ヘッダー右端のアクションスロット。 */
  headerRight?: ReactNode;
  /** 戻る挙動。既定は router.back()。 */
  onClose?: () => void;
  /** 本文を ScrollView で包むか。FlatList 等を子に持つ画面は false にする。既定 true。 */
  scrollable?: boolean;
  children: ReactNode;
};

export function ModalScreen({
  title,
  subtitle,
  headerRight,
  onClose,
  scrollable = true,
  children,
}: ModalScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          onPress={onClose ?? (() => router.back())}
          style={styles.back}
        >
          <Icon name="chevronLeft" size={24} color="text" />
        </Pressable>
        <View style={styles.titles}>
          <Text variant="heading3" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerRight}>{headerRight}</View>
      </View>
      {scrollable ? (
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
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
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  back: {
    padding: theme.spacing.xs,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flexGrow: 1,
    paddingBottom: theme.spacing.xxl,
  },
  body: {
    flex: 1,
  },
}));
