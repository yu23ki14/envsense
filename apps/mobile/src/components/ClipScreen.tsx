/**
 * ClipScreen — タブ画面の共通シェル。
 *
 * 背景・上部セーフエリア・ヘッダー帯・スクロール領域をまとめる。下部のタブバーは
 * Tabs ナビゲーター（app/(tabs)/_layout.tsx）が描画するため、ここには含めない。
 */
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { ClipHeaderStrip, type ClipHeaderStripProps } from './ClipHeaderStrip';

export type ClipScreenProps = {
  children: ReactNode;
  /** ヘッダー帯を非表示にする。 */
  hideHeader?: boolean;
  /** ヘッダー帯のデバイスステータスへ渡す props。 */
  status?: ClipHeaderStripProps['status'];
};

export function ClipScreen({ children, hideHeader = false, status }: ClipScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top }}>
        {!hideHeader && <ClipHeaderStrip status={status} />}
      </View>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flexGrow: 1,
    paddingBottom: theme.spacing.xxl,
  },
}));
