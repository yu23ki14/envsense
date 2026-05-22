/**
 * ClipHeaderStrip — 各タブ画面の上部に置くヘッダー帯。
 *
 * 現状は右端のデバイスステータスチップのみ。左側はスペーサーで空けておき、
 * 将来タイトルやアクションを足せる余地を残す。
 */
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ClipDeviceStatus, type ClipDeviceStatusProps } from './ClipDeviceStatus';

export type ClipHeaderStripProps = {
  /** デバイスステータスチップへ渡す props（MVP ではダミー値）。 */
  status?: ClipDeviceStatusProps;
};

export function ClipHeaderStrip({ status }: ClipHeaderStripProps) {
  return (
    <View style={styles.strip}>
      <View style={styles.spacer} />
      <ClipDeviceStatus {...status} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.xxs,
    paddingBottom: theme.spacing.xs,
  },
  spacer: {
    flex: 1,
  },
}));
