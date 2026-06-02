/**
 * DeviceScreen — 「デバイス」タブの本体。
 *
 * 上にステータス大カード、その下に撮影 / 音声 / 同期 / デバイス情報の
 * 設定リストを並べ、末尾にエクスポートへの導線を置く。各値は MMKV の
 * Settings / PairedDevice から読む（編集 UI は別 Issue）。
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ClipScreen, ListRow, SectionHeader } from '../components';
import { usePairedDevice, useSettings } from '../data';
import { Button, Icon, type IconName, Text } from '../ui';

function autoSyncLabel(mode: 'wifi' | 'always' | 'manual'): string {
  switch (mode) {
    case 'wifi':
      return 'Wi-Fi のみ';
    case 'always':
      return '常時';
    case 'manual':
      return '手動';
  }
}

export function DeviceScreen() {
  const settings = useSettings();
  const device = usePairedDevice();

  const connected = device != null;
  const headerSubtitle =
    device != null ? `${device.name} · #${device.id.slice(-6)}` : 'デバイス未登録';
  const statusTitle = connected ? '接続中' : '未接続';
  const statusDesc = connected
    ? `${settings.capture.intervalSec} 秒ごとに撮影しています`
    : 'デバイスをペアリングしてください';

  const batteryLabel = device?.lastBatteryPercent != null ? `${device.lastBatteryPercent}%` : '—';
  const rssiLabel = device?.lastRssi != null ? `${device.lastRssi} dBm` : '—';

  return (
    <ClipScreen>
      <View style={styles.flow}>
        <View style={styles.header}>
          <Text variant="caption" color="textMuted">
            {headerSubtitle}
          </Text>
          <Text variant="heading2">デバイス</Text>
        </View>

        <View style={styles.gutter}>
          <Card>
            <View style={styles.statusHead}>
              <View style={styles.statusBadge}>
                <Icon name="clip" size={24} color="onPrimary" />
              </View>
              <View style={styles.statusTexts}>
                <Text variant="label" weight="bold">
                  {statusTitle}
                </Text>
                <Text variant="caption" color="textMuted">
                  {statusDesc}
                </Text>
              </View>
            </View>
            <View style={styles.statusMetrics}>
              <StatusMetric icon="battery" label="バッテリー" value={batteryLabel} />
              <StatusMetric icon="bluetooth" label="信号" value={rssiLabel} />
              <StatusMetric icon="cloud" label="未同期" value="—" />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="撮影" title="カメラ" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="image"
              title="撮影間隔"
              value={`${settings.capture.intervalSec} 秒`}
              onPress={() => undefined}
            />
            <RowDivider />
            <ListRow
              icon="bolt"
              title="解像度"
              value={settings.capture.resolution}
              onPress={() => undefined}
            />
            <RowDivider />
            <ListRow
              icon="lock"
              title="プライベートモード"
              description="撮影を一時停止する"
              value={settings.capture.privateMode ? 'オン' : 'オフ'}
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SectionHeader kicker="音声" title="マイク" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="mic"
              title="録音"
              value={settings.audio.autoRecord ? '自動' : '手動'}
              onPress={() => undefined}
            />
            <RowDivider />
            <ListRow
              icon="ear"
              title="文字起こしモデル"
              value={settings.audio.transcriptionModel}
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SectionHeader kicker="同期" title="クラウド" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="cloud"
              title="自動同期"
              value={autoSyncLabel(settings.sync.autoSyncMode)}
              onPress={() => undefined}
            />
            <RowDivider />
            <ListRow
              icon="wifi"
              title="ネットワーク"
              value={settings.sync.preferredSsid ?? '未設定'}
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SectionHeader kicker="デバイス" title="情報" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="cpu"
              title="ファームウェア"
              value={device?.firmwareVersion ?? '—'}
              onPress={() => undefined}
            />
            <RowDivider />
            <ListRow icon="refresh" title="アップデートを確認" onPress={() => undefined} />
            <RowDivider />
            <ListRow icon="help" title="ヘルプ" onPress={() => undefined} />
          </Card>
        </View>

        <View style={styles.actions}>
          <Button
            variant="outline"
            iconLeft={<Icon name="download" size={16} color="primary" />}
            onPress={() => router.push('/export')}
          >
            記録をエクスポート
          </Button>
        </View>
      </View>
    </ClipScreen>
  );
}

function StatusMetric({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.statusMetric}>
      <View style={styles.statusMetricHead}>
        <Icon name={icon} size={14} color="textMuted" />
        <Text variant="caption" color="textMuted">
          {label}
        </Text>
      </View>
      <Text variant="label" weight="bold">
        {value}
      </Text>
    </View>
  );
}

function RowDivider() {
  return <View style={styles.rowDivider} />;
}

const styles = StyleSheet.create((theme) => ({
  flow: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.xxs,
  },
  gutter: {
    paddingHorizontal: theme.spacing.lg,
  },
  statusHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  statusBadge: {
    width: 44,
    height: 44,
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTexts: {
    flex: 1,
    gap: 2,
  },
  statusMetrics: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  statusMetric: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  statusMetricHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
  },
  rowDivider: {
    height: 1,
    marginLeft: theme.spacing.xxl,
    backgroundColor: theme.colors.border,
  },
  actions: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
}));
