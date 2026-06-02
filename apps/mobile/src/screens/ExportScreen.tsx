/**
 * ExportScreen — 「エクスポート」モーダルの本体。
 *
 * 範囲 / 含めるデータ / 形式 / 送り先 を選び、CTA でエクスポートを開始する
 * フォーム。MVP では実処理はないので onPress は no-op。
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
  Card,
  ListRow,
  ModalScreen,
  SectionHeader,
  SegmentedControl,
  type SegmentedControlOption,
} from '../components';
import { Button, Checkbox, Icon, RadioGroup, type RadioOption, Text } from '../ui';

type Range = 'today' | 'week' | 'custom';
type Format = 'zip' | 'json' | 'markdown';

const RANGE_OPTIONS: SegmentedControlOption<Range>[] = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '今週' },
  { value: 'custom', label: '範囲指定' },
];

const FORMAT_OPTIONS: RadioOption<Format>[] = [
  { value: 'zip', label: 'ZIP（写真 + 音声 + テキスト）' },
  { value: 'json', label: 'JSON（メタデータのみ）' },
  { value: 'markdown', label: 'Markdown（テキストのみ）' },
];

export function ExportScreen() {
  const [range, setRange] = useState<Range>('today');
  const [photos, setPhotos] = useState(true);
  const [audio, setAudio] = useState(true);
  const [transcripts, setTranscripts] = useState(true);
  const [summary, setSummary] = useState(false);
  const [format, setFormat] = useState<Format>('zip');

  return (
    <ModalScreen title="エクスポート" subtitle="記録を書き出す">
      <View style={styles.flow}>
        <SectionHeader kicker="範囲" title="いつの記録を" />
        <View style={styles.gutter}>
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </View>

        <SectionHeader kicker="内容" title="含めるデータ" />
        <View style={styles.gutter}>
          <Card padding="md">
            <View style={styles.checkList}>
              <Checkbox checked={photos} onChange={setPhotos} label="写真" />
              <Checkbox checked={audio} onChange={setAudio} label="音声ファイル" />
              <Checkbox checked={transcripts} onChange={setTranscripts} label="文字起こし" />
              <Checkbox checked={summary} onChange={setSummary} label="エージェントの要約" />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="形式" title="ファイル形式" />
        <View style={styles.gutter}>
          <Card padding="md">
            <RadioGroup options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
          </Card>
        </View>

        <SectionHeader kicker="送り先" title="保存方法" />
        <View style={styles.gutter}>
          <Card padding="none">
            <ListRow icon="share" title="共有シートで送る" onPress={() => undefined} />
            <RowDivider />
            <ListRow icon="cloud" title="iCloud Drive に保存" onPress={() => undefined} />
            <RowDivider />
            <ListRow icon="download" title="端末にダウンロード" onPress={() => undefined} />
          </Card>
        </View>

        <View style={styles.actions}>
          <Button
            iconLeft={<Icon name="download" size={16} color="onPrimary" />}
            onPress={() => router.back()}
          >
            エクスポートを開始
          </Button>
          <Text variant="caption" color="textMuted" style={styles.note}>
            選択したデータを暗号化された ZIP にまとめてから共有します。
          </Text>
        </View>
      </View>
    </ModalScreen>
  );
}

function RowDivider() {
  return <View style={styles.rowDivider} />;
}

const styles = StyleSheet.create((theme) => ({
  flow: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  gutter: {
    paddingHorizontal: theme.spacing.lg,
  },
  checkList: {
    gap: theme.spacing.xs,
  },
  rowDivider: {
    height: 1,
    marginLeft: theme.spacing.xxl,
    backgroundColor: theme.colors.border,
  },
  actions: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  note: {
    textAlign: 'center',
  },
}));
