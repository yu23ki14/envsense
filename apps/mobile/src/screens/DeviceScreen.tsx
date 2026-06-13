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
import {
  Card,
  ClipScreen,
  ConfirmModal,
  ListRow,
  SectionHeader,
  SettingSelectModal,
  type SettingSelectOption,
} from '../components';
import { secrets, updateSettings, usePairedDevice, useSettings } from '../data';
import { useDeviceContext } from '../modules/DeviceProvider';
import type { CaptureMode } from '../modules/deviceMode';
import { rebootDevice, sleepDevice } from '../modules/devicePower';
import {
  localModelIdOf,
  SUMMARY_MODELS,
  summaryLabel,
  TRANSCRIPTION_MODELS,
  transcriptionLabel,
  useWhisperModel,
} from '../modules/llm';
import { CAPTURE_INTERVAL_SEC } from '../modules/useDeviceCapture';
import { Button, Icon, type IconName, Text, TextField } from '../ui';

const KIND_GROUP: Record<'cloud' | 'local', string> = {
  cloud: 'クラウド',
  local: 'ローカル',
};

const TRANSCRIPTION_OPTIONS: SettingSelectOption<string>[] = TRANSCRIPTION_MODELS.map((m) => ({
  value: m.ref,
  label: m.label,
  note: m.note,
  group: KIND_GROUP[m.kind],
}));

const SUMMARY_OPTIONS: SettingSelectOption<string>[] = SUMMARY_MODELS.map((m) => ({
  value: m.ref,
  label: m.label,
  note: m.note,
  group: KIND_GROUP[m.kind],
}));

const CAPTURE_MODE_OPTIONS: SettingSelectOption<CaptureMode>[] = [
  {
    value: 'local',
    label: 'ローカル保存',
    note: 'SD カードに記録し、あとからまとめて同期する（バッテリー長持ち）',
  },
  {
    value: 'streaming',
    label: 'ストリーミング',
    note: '接続中はアプリへ即時転送。圏外の間は SD カードに記録して後で同期',
  },
];

function captureModeLabel(mode: CaptureMode): string {
  return mode === 'local' ? 'ローカル保存' : 'ストリーミング';
}

const LANGUAGE_OPTIONS: SettingSelectOption<string>[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  {
    value: 'auto',
    label: '自動判定',
    note: 'whisper に言語を推定させる（短い音声では精度が落ちることがあります）',
  },
];

function languageLabel(value: string): string {
  return LANGUAGE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function DeviceScreen() {
  const settings = useSettings();
  const paired = usePairedDevice();
  const { device: liveDevice, status, sync, mode, connect, disconnect } = useDeviceContext();
  const [captureModeModalOpen, setCaptureModeModalOpen] = useState(false);
  const [transcriptionModalOpen, setTranscriptionModalOpen] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [languageModalOpen, setLanguageModalOpen] = useState(false);
  const [powerAction, setPowerAction] = useState<'sleep' | 'reboot' | null>(null);
  const [powerBusy, setPowerBusy] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const selectedModelId = localModelIdOf(settings.audio.transcriptionModel);
  const selectedSummaryModelId = localModelIdOf(settings.summary.model);

  const isLive = liveDevice != null;
  const headerSubtitle =
    paired != null ? `${paired.name} · #${paired.id.slice(-6)}` : 'デバイス未登録';

  let statusTitle = '未接続';
  if (isLive) statusTitle = '接続中';
  else if (status.isAutoConnecting) statusTitle = '再接続中';
  else if (status.isConnecting) statusTitle = '接続要求中';

  const statusDesc = isLive
    ? mode.deviceMode === 'streaming'
      ? `ストリーミング中 · ${CAPTURE_INTERVAL_SEC} 秒ごとに撮影`
      : `${CAPTURE_INTERVAL_SEC} 秒ごとに撮影しています`
    : paired != null
      ? 'デバイスが範囲外か電源オフです'
      : 'デバイスをペアリングしてください';

  // 設定（ユーザーの意図）とデバイスの実効モードの食い違いを説明する。
  let captureModeDesc = 'ローカル保存とストリーミングを切り替える';
  if (isLive && !mode.supported) {
    captureModeDesc = 'このファームウェアはモード切替に未対応です';
  } else if (
    isLive &&
    settings.capture.captureMode === 'local' &&
    mode.deviceMode === 'streaming'
  ) {
    captureModeDesc = 'SD カードが見つからないためストリーミングで動作中';
  }

  const batteryLabel = paired?.lastBatteryPercent != null ? `${paired.lastBatteryPercent}%` : '—';
  const rssiLabel = paired?.lastRssi != null ? `${paired.lastRssi} dBm` : '—';

  const unsyncedFiles =
    sync.status != null ? sync.status.audioFiles + sync.status.photoFiles : null;
  const unsyncedLabel = unsyncedFiles != null ? `${unsyncedFiles} 件` : '—';
  const syncProgressRatio =
    sync.progress != null && sync.progress.totalBytes > 0
      ? Math.min(1, sync.progress.doneBytes / sync.progress.totalBytes)
      : 0;

  const runPowerAction = async () => {
    if (liveDevice == null || powerAction == null) return;
    setPowerBusy(true);
    try {
      if (powerAction === 'sleep') await sleepDevice(liveDevice);
      else await rebootDevice(liveDevice);
    } catch (e) {
      // コマンド書き込み直後にデバイス側から切断されるため、ここでの失敗は
      // むしろ「スリープ / 再起動した」合図。エラー表示はしない。
      console.log('Power command write ended with', e);
    } finally {
      setPowerBusy(false);
      setPowerAction(null);
    }
  };

  return (
    <ClipScreen
      status={{
        connection: isLive ? 'connected' : 'disconnected',
        batteryPercent: paired?.lastBatteryPercent ?? null,
        unsyncedCount: unsyncedFiles,
      }}
    >
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
              <StatusMetric icon="cloud" label="未同期" value={unsyncedLabel} />
            </View>
            {isLive && unsyncedFiles != null && (unsyncedFiles > 0 || sync.syncing) ? (
              <View style={styles.syncSection}>
                {sync.syncing ? (
                  <>
                    <Text variant="caption" color="textMuted">
                      {sync.progress != null && sync.progress.phase === 'transfer'
                        ? `同期中 ${sync.progress.doneFiles}/${sync.progress.totalFiles} 件 · ${formatBytes(sync.progress.doneBytes)} / ${formatBytes(sync.progress.totalBytes)}`
                        : sync.progress?.phase === 'finishing'
                          ? '文字起こしを仕上げています…'
                          : 'ファイル一覧を取得中…'}
                    </Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.round(syncProgressRatio * 100)}%` },
                        ]}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Button
                      onPress={sync.startSync}
                      iconLeft={<Icon name="cloud" size={16} color="onPrimary" />}
                    >
                      {`同期する（${unsyncedFiles} 件 · ${formatBytes(sync.status?.totalBytes ?? 0)}）`}
                    </Button>
                    <Button
                      variant="text"
                      onPress={() => setDeleteAllOpen(true)}
                      loading={sync.deleting}
                      iconLeft={<Icon name="trash" size={16} color="error" />}
                    >
                      同期せずすべて削除
                    </Button>
                  </>
                )}
                {sync.error != null && !sync.syncing ? (
                  <Text variant="caption" color="error">
                    同期に失敗しました: {sync.error}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={styles.statusAction}>
              {isLive ? (
                <View style={styles.statusButtons}>
                  <View style={styles.statusButton}>
                    <Button
                      variant="outline"
                      onPress={disconnect}
                      iconLeft={<Icon name="bluetooth" size={16} color="primary" />}
                    >
                      切断する
                    </Button>
                  </View>
                  <View style={styles.statusButton}>
                    <Button
                      variant="outline"
                      onPress={() => setPowerAction('sleep')}
                      iconLeft={<Icon name="pause" size={16} color="primary" />}
                    >
                      スリープ
                    </Button>
                  </View>
                </View>
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

        <SectionHeader kicker="動作" title="キャプチャモード" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="filter"
              title="モード"
              description={captureModeDesc}
              value={captureModeLabel(settings.capture.captureMode)}
              onPress={() => setCaptureModeModalOpen(true)}
            />
          </Card>
        </View>

        <SectionHeader kicker="撮影" title="カメラ" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="image"
              title="撮影間隔"
              description="ファームウェア側で固定"
              value={`${CAPTURE_INTERVAL_SEC} 秒`}
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
              title={'文字起こし\nモデル'}
              value={transcriptionLabel(settings.audio.transcriptionModel)}
              onPress={() => setTranscriptionModalOpen(true)}
            />
            {selectedModelId != null ? (
              <>
                <RowDivider />
                <LocalModelRow modelId={selectedModelId} />
                <RowDivider />
                <ListRow
                  icon="cloud"
                  title="クラウド補完"
                  description="ローカル失敗時に Groq で文字起こし"
                  value={settings.audio.cloudFallback ? 'オン' : 'オフ'}
                  onPress={() =>
                    updateSettings((s) => ({
                      ...s,
                      audio: { ...s.audio, cloudFallback: !s.audio.cloudFallback },
                    }))
                  }
                />
              </>
            ) : null}
            <RowDivider />
            <ListRow
              icon="globe"
              title="文字起こし言語"
              value={languageLabel(settings.audio.transcriptionLanguage)}
              onPress={() => setLanguageModalOpen(true)}
            />
          </Card>
        </View>

        <SectionHeader kicker="AI" title="サマリ生成" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow
              icon="spark"
              title="生成モデル"
              description="セッション要約と日記の生成に使用"
              value={summaryLabel(settings.summary.model)}
              onPress={() => setSummaryModalOpen(true)}
            />
            {selectedSummaryModelId != null ? (
              <>
                <RowDivider />
                <LocalModelRow modelId={selectedSummaryModelId} />
                <RowDivider />
                <ListRow
                  icon="cloud"
                  title="クラウド補完"
                  description="ローカル失敗時に Groq で生成・写真の説明にも使用"
                  value={settings.summary.cloudFallback ? 'オン' : 'オフ'}
                  onPress={() =>
                    updateSettings((s) => ({
                      ...s,
                      summary: { ...s.summary, cloudFallback: !s.summary.cloudFallback },
                    }))
                  }
                />
              </>
            ) : null}
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
            <ListRow
              icon="bolt"
              title="再起動"
              description={isLive ? 'デバイスを再起動する' : '接続中のみ操作できます'}
              onPress={() => (isLive ? setPowerAction('reboot') : undefined)}
            />
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

      <SettingSelectModal
        visible={captureModeModalOpen}
        title="キャプチャモード"
        options={CAPTURE_MODE_OPTIONS}
        value={settings.capture.captureMode}
        onSelect={(m) => {
          void mode.setMode(m);
        }}
        onClose={() => setCaptureModeModalOpen(false)}
      />

      <SettingSelectModal
        visible={transcriptionModalOpen}
        title="文字起こしモデル"
        options={TRANSCRIPTION_OPTIONS}
        value={settings.audio.transcriptionModel}
        onSelect={(ref) =>
          updateSettings((s) => ({ ...s, audio: { ...s.audio, transcriptionModel: ref } }))
        }
        onClose={() => setTranscriptionModalOpen(false)}
      />

      <SettingSelectModal
        visible={summaryModalOpen}
        title="サマリ生成モデル"
        options={SUMMARY_OPTIONS}
        value={settings.summary.model}
        onSelect={(ref) => updateSettings((s) => ({ ...s, summary: { ...s.summary, model: ref } }))}
        onClose={() => setSummaryModalOpen(false)}
      />

      <SettingSelectModal
        visible={languageModalOpen}
        title="文字起こし言語"
        options={LANGUAGE_OPTIONS}
        value={settings.audio.transcriptionLanguage}
        onSelect={(language) =>
          updateSettings((s) => ({ ...s, audio: { ...s.audio, transcriptionLanguage: language } }))
        }
        onClose={() => setLanguageModalOpen(false)}
      />

      <ConfirmModal
        visible={powerAction != null}
        title={
          powerAction === 'reboot' ? 'デバイスを再起動しますか？' : 'デバイスをスリープしますか？'
        }
        message={
          powerAction === 'reboot'
            ? '再起動中は一時的に切断されます。起動後は自動で再接続を試みます。'
            : 'スリープ中は撮影と録音が止まり、接続も切断されます。起こすには本体の銅箔に触れるか、ボタンを押してください。'
        }
        confirmLabel={powerAction === 'reboot' ? '再起動' : 'スリープ'}
        busy={powerBusy}
        onConfirm={runPowerAction}
        onClose={() => setPowerAction(null)}
      />

      <ConfirmModal
        visible={deleteAllOpen}
        title="未同期データをすべて削除しますか？"
        message={`デバイス上の未同期ファイル ${unsyncedFiles ?? 0} 件（${formatBytes(
          sync.status?.totalBytes ?? 0,
        )}）を転送せずに完全に削除します。この操作は取り消せません。`}
        confirmLabel="すべて削除"
        busy={sync.deleting}
        onConfirm={async () => {
          await sync.deleteAll();
          setDeleteAllOpen(false);
        }}
        onClose={() => setDeleteAllOpen(false)}
      />
    </ClipScreen>
  );
}

/**
 * 選択中のローカル (Cactus) モデルのダウンロード状態を表示する行。
 * 未 DL の間はクラウドにフォールバックして動作する。
 */
function LocalModelRow({ modelId }: { modelId: string }) {
  const { status, progress, error, download, remove } = useWhisperModel(modelId);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const runDelete = async () => {
    setDeleting(true);
    try {
      await remove();
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  let detail = 'オフライン文字起こしに必要';
  if (status === 'unknown') detail = '確認中…';
  else if (status === 'downloading') detail = `ダウンロード中 ${Math.round(progress * 100)}%`;
  else if (status === 'ready') detail = '準備完了・オフライン可';
  else if (error != null) detail = error;

  return (
    <View style={styles.modelRow}>
      <View style={styles.modelHead}>
        <View style={styles.modelIcon}>
          <Icon name="cpu" size={20} color="textMuted" />
        </View>
        <View style={styles.modelTexts}>
          <Text variant="label">ローカルモデル</Text>
          <Text variant="caption" color={error != null ? 'error' : 'textMuted'}>
            {detail}
          </Text>
        </View>
        {status === 'absent' ? (
          <Button size="sm" variant="outline" onPress={download}>
            ダウンロード
          </Button>
        ) : null}
        {status === 'ready' ? (
          <Button size="sm" variant="outline" onPress={() => setDeleteConfirmOpen(true)}>
            削除
          </Button>
        ) : null}
      </View>
      {status === 'downloading' ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}

      <ConfirmModal
        visible={deleteConfirmOpen}
        title="ローカルモデルを削除しますか？"
        message="モデルファイルを端末から削除してストレージを空けます。再び使うには数GBの再ダウンロードが必要です。削除後はクラウドにフォールバックします。"
        confirmLabel="削除"
        busy={deleting}
        onConfirm={runDelete}
        onClose={() => setDeleteConfirmOpen(false)}
      />
    </View>
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
          helpText="文字起こし・サマリ生成・写真の説明に使用"
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
  syncSection: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  statusButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  statusButton: {
    flex: 1,
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
  modelRow: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  modelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  modelIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.radius[8],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  modelTexts: {
    flex: 1,
    gap: 2,
  },
  progressTrack: {
    height: 4,
    borderRadius: theme.radius[8],
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: theme.radius[8],
    backgroundColor: theme.colors.primary,
  },
}));
