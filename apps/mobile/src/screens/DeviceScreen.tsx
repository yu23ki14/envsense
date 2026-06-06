/**
 * DeviceScreen — 「デバイス」タブの本体。
 *
 * 上にステータス大カード、その下に撮影 / 音声 / 同期 / デバイス情報の
 * 設定リストを並べ、末尾にエクスポートへの導線を置く。各値は MMKV の
 * Settings / PairedDevice から読む（編集 UI は別 Issue）。
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ClipScreen, ListRow, SectionHeader } from '../components';
import { secrets, usePairedDevice, useSettings } from '../data';
import { useDeviceContext } from '../modules/DeviceProvider';
import { Button, Icon, type IconName, Text, TextField } from '../ui';

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
  const paired = usePairedDevice();
  const { device: liveDevice, status, connect, disconnect } = useDeviceContext();

  const isLive = liveDevice != null;
  const headerSubtitle =
    paired != null ? `${paired.name} · #${paired.id.slice(-6)}` : 'デバイス未登録';

  let statusTitle = '未接続';
  if (isLive) statusTitle = '接続中';
  else if (status.isAutoConnecting) statusTitle = '再接続中';
  else if (status.isConnecting) statusTitle = '接続要求中';

  const statusDesc = isLive
    ? `${settings.capture.intervalSec} 秒ごとに撮影しています`
    : paired != null
      ? 'デバイスが範囲外か電源オフです'
      : 'デバイスをペアリングしてください';

  const batteryLabel = paired?.lastBatteryPercent != null ? `${paired.lastBatteryPercent}%` : '—';
  const rssiLabel = paired?.lastRssi != null ? `${paired.lastRssi} dBm` : '—';

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
            <View style={styles.statusAction}>
              {isLive ? (
                <Button
                  variant="outline"
                  onPress={disconnect}
                  iconLeft={<Icon name="bluetooth" size={16} color="primary" />}
                >
                  切断する
                </Button>
              ) : (
                <Button
                  variant="outline"
                  loading={status.isConnecting || status.isAutoConnecting}
                  onPress={connect}
                  iconLeft={<Icon name="bluetooth" size={16} color="primary" />}
                >
                  {paired != null ? '再接続する' : 'デバイスを接続'}
                </Button>
              )}
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

        <SectionHeader kicker="API" title="エージェントの接続" />
        <View style={styles.gutter}>
          <ApiKeysCard />
        </View>

        <SectionHeader kicker="デバイス" title="情報" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="cpu"
              title="ファームウェア"
              value={paired?.firmwareVersion ?? '—'}
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

function ApiKeysCard() {
  const [groq, setGroq] = useState('');
  const [openai, setOpenai] = useState('');
  const [originalGroq, setOriginalGroq] = useState('');
  const [originalOpenai, setOriginalOpenai] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [g, o] = await Promise.all([
        secrets.getSecret('groqApiKey'),
        secrets.getSecret('openaiApiKey'),
      ]);
      if (cancelled) return;
      setGroq(g ?? '');
      setOpenai(o ?? '');
      setOriginalGroq(g ?? '');
      setOriginalOpenai(o ?? '');
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = loaded && (groq !== originalGroq || openai !== originalOpenai);

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        groq.length > 0
          ? secrets.setSecret('groqApiKey', groq)
          : secrets.deleteSecret('groqApiKey'),
        openai.length > 0
          ? secrets.setSecret('openaiApiKey', openai)
          : secrets.deleteSecret('openaiApiKey'),
      ]);
      setOriginalGroq(groq);
      setOriginalOpenai(openai);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="md">
      <View style={styles.apiKeysList}>
        <TextField
          label="Groq API キー"
          placeholder="gsk_..."
          helpText="ハイライト生成と Vision に使用"
          value={groq}
          onChangeText={setGroq}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          disabled={!loaded}
        />
        <TextField
          label="OpenAI API キー"
          placeholder="sk-..."
          helpText="将来のフォールバック用 (任意)"
          value={openai}
          onChangeText={setOpenai}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          disabled={!loaded}
        />
        <Button onPress={save} disabled={!dirty} loading={saving}>
          {dirty ? '保存' : '保存済み'}
        </Button>
      </View>
    </Card>
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
  statusAction: {
    marginTop: theme.spacing.md,
  },
  apiKeysList: {
    gap: theme.spacing.sm,
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
