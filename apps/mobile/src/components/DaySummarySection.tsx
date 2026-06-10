/**
 * DaySummarySection — 日別ジャーナルに置く AI サマリ（日記 + セッション要約）。
 *
 * 生成結果は MMKV の DaySummary を反応的に読む。未生成なら生成ボタン、生成済みなら
 * 本文と再生成ボタンを出し、生成中はフェーズ別の進捗ラベルを表示する。生成後に
 * 記録が増えた場合は「古くなっている」ヒントを出す。
 */
import { format } from 'date-fns';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useDay, useDaySummary } from '../data';
import { summaryLabel } from '../modules/llm';
import { type SummaryProgress, useSummaryGenerator } from '../modules/summary';
import { Button, Icon, Text } from '../ui';
import { Card } from './Card';

function clock(ms: number): string {
  return format(ms, 'HH:mm');
}

function progressLabel(progress: SummaryProgress | null): string {
  if (progress == null) return '生成を開始しています…';
  switch (progress.phase) {
    case 'photos':
      return `写真を解析中 ${progress.current}/${progress.total}`;
    case 'sessions':
      return `会話を要約中 ${Math.min(progress.current + 1, progress.total)}/${progress.total}`;
    case 'day':
      return '日記を作成中…';
  }
}

export type DaySummarySectionProps = {
  date: string;
};

export function DaySummarySection({ date }: DaySummarySectionProps) {
  const day = useDay(date);
  const summary = useDaySummary(date);
  const { generating, progress, error, generate } = useSummaryGenerator(date);

  const hasInputs = day != null && (day.audioChunkIds.length > 0 || day.photoIds.length > 0);
  const stale =
    summary != null &&
    day != null &&
    (day.audioChunkIds.length !== summary.sourceChunkCount ||
      day.photoIds.length !== summary.sourcePhotoCount);

  if (summary == null) {
    return (
      <Card tone="soft" padding="md">
        <Text variant="caption" color="textMuted">
          {hasInputs
            ? 'その日の文字起こしと写真から、セッションごとの要約と日記を生成できます。'
            : 'この日の記録（文字起こし・写真）が貯まると、サマリを生成できます。'}
        </Text>
        {error != null ? (
          <Text variant="caption" color="error" style={styles.errorText}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actionRow}>
          <Button
            variant="outline"
            disabled={!hasInputs}
            loading={generating}
            iconLeft={generating ? undefined : <Icon name="spark" size={16} color="primary" />}
            onPress={generate}
          >
            {generating ? progressLabel(progress) : 'サマリを生成'}
          </Button>
        </View>
      </Card>
    );
  }

  return (
    <View style={styles.flow}>
      <Card>
        <View style={styles.cardHead}>
          <Icon name="journal" size={14} color="textMuted" />
          <Text variant="caption" color="textMuted">
            {`${format(summary.generatedAt, 'M/d HH:mm')} 生成 · ${summaryLabel(summary.generatedBy)}`}
          </Text>
        </View>
        <Text variant="heading3" style={styles.title}>
          {summary.title}
        </Text>
        <Text variant="body" style={styles.body}>
          {summary.body}
        </Text>
      </Card>

      {summary.sessions.map((s) => (
        <Card key={s.sessionId} tone="soft">
          <View style={styles.cardHead}>
            <Icon name="mic" size={14} color="textMuted" />
            <Text variant="caption" color="textMuted">
              {`${clock(s.startedAt)}〜${clock(s.endedAt)}`}
            </Text>
          </View>
          <Text variant="label" weight="bold" style={styles.sessionTitle}>
            {s.title}
          </Text>
          <Text variant="caption" color="textMuted" style={styles.sessionText}>
            {s.text}
          </Text>
        </Card>
      ))}

      {stale && !generating ? (
        <Text variant="caption" color="textMuted">
          生成後に新しい記録が追加されています。再生成すると反映されます。
        </Text>
      ) : null}
      {error != null ? (
        <Text variant="caption" color="error">
          {error}
        </Text>
      ) : null}
      <Button
        variant="outline"
        loading={generating}
        iconLeft={generating ? undefined : <Icon name="refresh" size={16} color="primary" />}
        onPress={generate}
      >
        {generating ? progressLabel(progress) : '再生成する'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flow: {
    gap: theme.spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
  },
  title: {
    marginTop: theme.spacing.xs,
  },
  body: {
    marginTop: theme.spacing.xs,
  },
  sessionTitle: {
    marginTop: theme.spacing.xs,
  },
  sessionText: {
    marginTop: theme.spacing.xxs,
  },
  errorText: {
    marginTop: theme.spacing.xs,
  },
  actionRow: {
    marginTop: theme.spacing.sm,
  },
}));
