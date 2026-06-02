/**
 * DeviceScreen — 「デバイス」タブの本体。
 *
 * 上にステータス大カード、その下に撮影 / 音声 / 同期 / デバイス情報の
 * 設定リストを並べ、末尾にエクスポートへの導線を置く。MVP のため値はダミーで、
 * 実機との配線は別 Issue で行う。
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ClipScreen, ListRow, SectionHeader } from '../components';
import { Button, Icon, type IconName, Text } from '../ui';

export function DeviceScreen() {
  return (
    <ClipScreen>
      <View style={styles.flow}>
        <View style={styles.header}>
          <Text variant="caption" color="textMuted">
            My Clip · #C0FFEE
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
                  接続中
                </Text>
                <Text variant="caption" color="textMuted">
                  5 秒ごとに撮影しています
                </Text>
              </View>
            </View>
            <View style={styles.statusMetrics}>
              <StatusMetric icon="battery" label="バッテリー" value="78%" />
              <StatusMetric icon="bluetooth" label="信号" value="強" />
              <StatusMetric icon="cloud" label="未同期" value="12 件" />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="撮影" title="カメラ" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow icon="image" title="撮影間隔" value="5 秒" onPress={() => undefined} />
            <RowDivider />
            <ListRow icon="bolt" title="解像度" value="VGA" onPress={() => undefined} />
            <RowDivider />
            <ListRow
              icon="lock"
              title="プライベートモード"
              description="撮影を一時停止する"
              value="オフ"
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SectionHeader kicker="音声" title="マイク" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow icon="mic" title="録音" value="自動" onPress={() => undefined} />
            <RowDivider />
            <ListRow
              icon="ear"
              title="文字起こしモデル"
              value="Whisper Large"
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SectionHeader kicker="同期" title="クラウド" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow icon="cloud" title="自動同期" value="Wi-Fi のみ" onPress={() => undefined} />
            <RowDivider />
            <ListRow
              icon="wifi"
              title="ネットワーク"
              value="senspace-5G"
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SectionHeader kicker="デバイス" title="情報" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow icon="cpu" title="ファームウェア" value="0.4.2" onPress={() => undefined} />
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
