/**
 * ClipDeviceStatus — ヘッダー右端に置く envsense デバイスのステータスチップ。
 *
 * 「Clip」ラベル・BLE 接続状態・バッテリー残量を 1 つのチップにまとめて表示する。
 * MVP 段階では値はダミー（props の既定値）。実機連携は別 Issue で配線する。
 */
import { BatteryMedium, Bluetooth, Camera } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '../ui';

export type ClipConnectionState = 'connected' | 'disconnected';

export type ClipDeviceStatusProps = {
  /** バッテリー残量（0〜1）。MVP ではダミー値。 */
  battery?: number;
  /** BLE 接続状態。MVP ではダミー値。 */
  connection?: ClipConnectionState;
  onPress?: () => void;
};

export function ClipDeviceStatus({
  battery = 0.78,
  connection = 'connected',
  onPress,
}: ClipDeviceStatusProps) {
  const { theme } = useUnistyles();
  const connected = connection === 'connected';

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.chip}>
      <View style={styles.iconBox}>
        <Camera size={12} color={theme.colors.onPrimary} />
      </View>
      <Text variant="caption" weight="bold">
        Clip
      </Text>
      <View style={styles.divider} />
      <Bluetooth size={13} color={connected ? theme.colors.success : theme.colors.textMuted} />
      <BatteryMedium size={16} color={theme.colors.textMuted} />
      <Text variant="caption" weight="bold">
        {Math.round(battery * 100)}%
      </Text>
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
