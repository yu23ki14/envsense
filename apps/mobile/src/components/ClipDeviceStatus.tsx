/**
 * ClipDeviceStatus — ヘッダー右端に置く envsense デバイスのステータスチップ。
 *
 * 「Clip」ラベル・BLE 接続状態・バッテリー残量を 1 つのチップにまとめて表示する。
 * 残量は PairedDevice.lastBatteryPercent（接続中に Battery Service から保存される
 * 最終値）を渡す。未取得は「—」表示。
 */
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Icon, Text } from '../ui';

export type ClipConnectionState = 'connected' | 'disconnected';

export type ClipDeviceStatusProps = {
  /** バッテリー残量（0〜100 の整数）。未取得は null。 */
  batteryPercent?: number | null;
  /** BLE 接続状態。 */
  connection?: ClipConnectionState;
  /** デバイス側の未同期ファイル数。未取得（旧FW・未接続）は null で非表示。 */
  unsyncedCount?: number | null;
  onPress?: () => void;
};

export function ClipDeviceStatus({
  batteryPercent = null,
  connection = 'disconnected',
  unsyncedCount = null,
  onPress,
}: ClipDeviceStatusProps) {
  const connected = connection === 'connected';

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.chip}>
      <View style={styles.iconBox}>
        <Icon name="clip" size={12} color="onPrimary" />
      </View>
      <Text variant="caption" weight="bold">
        Clip
      </Text>
      <View style={styles.divider} />
      <Icon name="bluetooth" size={13} color={connected ? 'success' : 'textMuted'} />
      <Text variant="caption" weight="bold" color={connected ? 'success' : 'textMuted'}>
        {connected ? '接続中' : '未接続'}
      </Text>
      <Icon name="battery" size={16} color="textMuted" />
      <Text variant="caption" weight="bold">
        {batteryPercent != null ? `${batteryPercent}%` : '—'}
      </Text>
      {unsyncedCount != null && unsyncedCount > 0 ? (
        <>
          <Icon name="cloud" size={13} color="textMuted" />
          <Text variant="caption" weight="bold" color="textMuted">
            {unsyncedCount}
          </Text>
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
    height: 32,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  iconBox: {
    width: 20,
    height: 20,
    borderRadius: theme.radius[6],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: theme.colors.border,
  },
}));
