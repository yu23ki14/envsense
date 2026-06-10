/**
 * TodayScreen — 「今日」タブの本体。
 *
 * 今日の活動サマリー、スナップショットグリッド、ハイライト引用、
 * エージェントへの質問 CTA を縦に並べる。今日 (端末ローカル日) の Day
 * ロールアップを MMKV から読み出して描画する。
 */
import { format } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ClipPhoto, ClipScreen, SectionHeader, Tag } from '../components';
import type { Highlight, Photo } from '../data';
import {
  dateKey,
  useAudioTotalMsForDay,
  useDay,
  useHighlightsForDay,
  usePhotosForDay,
} from '../data';
import { Button, Icon, Text } from '../ui';

const SNAPSHOT_LIMIT = 4;
const HIGHLIGHT_LIMIT = 5;

function formatClock(ms: number): string {
  return format(ms, 'HH:mm');
}

function formatTodayDate(now: number): string {
  return format(now, 'yyyy 年 M 月 d 日 EEEE', { locale: ja });
}

function formatDurationFromMs(totalMs: number): string {
  const minutes = Math.floor(totalMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hours}:${mm.toString().padStart(2, '0')}`;
}

export function TodayScreen() {
  const now = useMemo(() => Date.now(), []);
  const todayKey = useMemo(() => dateKey(now), [now]);

  const day = useDay(todayKey);
  const photos = usePhotosForDay(todayKey);
  const highlights = useHighlightsForDay(todayKey);
  const audioTotalMs = useAudioTotalMsForDay(todayKey);

  const snapshots = useMemo<Photo[]>(() => pickEvenlySpaced(photos, SNAPSHOT_LIMIT), [photos]);
  const recentHighlights = useMemo<Highlight[]>(
    () => highlights.slice(-HIGHLIGHT_LIMIT).reverse(),
    [highlights],
  );

  const photoCount = photos.length;
  const highlightCount = day?.highlightIds.length ?? highlights.length;
  const audioLabel = audioTotalMs > 0 ? formatDurationFromMs(audioTotalMs) : '0:00';

  return (
    <ClipScreen>
      <View style={styles.flow}>
        <View style={styles.intro}>
          <Text variant="caption" color="textMuted">
            {formatTodayDate(now)}
          </Text>
          <Text variant="heading1">今日のクリップ</Text>
        </View>

        <View style={styles.gutter}>
          <Card>
            <View style={styles.metrics}>
              <Metric label="写真" value={String(photoCount)} unit="枚" />
              <MetricDivider />
              <Metric label="録音" value={audioLabel} unit="時間" />
              <MetricDivider />
              <Metric label="ハイライト" value={String(highlightCount)} unit="件" />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="スナップショット" title="今日の眺め" />
        <View style={styles.gutter}>
          {snapshots.length === 0 ? (
            <EmptyHint message="まだ写真がありません。デバイスを接続すると 5 秒ごとに自動で撮影されます。" />
          ) : (
            <View style={styles.grid}>
              {snapshots.map((shot) => (
                <View key={shot.id} style={styles.gridItem}>
                  <ClipPhoto photo={shot} radius={12} />
                  <View style={styles.gridCaption}>
                    <Text variant="caption" weight="bold">
                      {formatClock(shot.capturedAt)}
                    </Text>
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {shot.description ?? '—'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <SectionHeader
          kicker="文字起こし"
          title="ハイライト"
          action={
            recentHighlights.length > 0 ? (
              <Text variant="caption" color="link">
                すべて見る
              </Text>
            ) : null
          }
        />
        <View style={[styles.gutter, styles.list]}>
          {recentHighlights.length === 0 ? (
            <EmptyHint message="ハイライトはまだ抽出されていません。録音が進むと自動で追加されます。" />
          ) : (
            recentHighlights.map((h) => (
              <Card key={h.id}>
                <View style={styles.highlightHead}>
                  <Icon name="spark" size={14} color="textMuted" />
                  <Text variant="caption" color="textMuted">
                    {formatClock(h.sourceAt)}
                  </Text>
                </View>
                <Text variant="body" style={styles.quote}>
                  {h.quote}
                </Text>
                {h.tags.length > 0 ? (
                  <View style={styles.tagRow}>
                    {h.tags.map((t) => (
                      <Tag key={t} label={`#${t}`} />
                    ))}
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </View>

        <View style={[styles.gutter, styles.linkActions]}>
          <Button
            variant="outline"
            iconLeft={<Icon name="ear" size={16} color="primary" />}
            onPress={() => router.push({ pathname: '/transcript', params: { date: todayKey } })}
          >
            録音と文字起こしを見る
          </Button>
          <Button
            variant="outline"
            iconLeft={<Icon name="journal" size={16} color="primary" />}
            onPress={() => router.push({ pathname: '/journal', params: { date: todayKey } })}
          >
            今日のまとめ（AI サマリ）
          </Button>
        </View>

        <View style={styles.gutter}>
          <Card tone="soft" padding="lg">
            <View style={styles.askHead}>
              <Icon name="spark" size={18} color="text" />
              <Text variant="label" weight="bold">
                エージェントに聞く
              </Text>
            </View>
            <Text variant="caption" color="textMuted" style={styles.askDesc}>
              今日の出来事や、昨日との比較などを自然な言葉で質問できます。
            </Text>
            <Button onPress={() => undefined}>質問を入力する</Button>
          </Card>
        </View>
      </View>
    </ClipScreen>
  );
}

function pickEvenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = (items.length - 1) / (count - 1);
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    const candidate = items[Math.round(i * step)];
    if (candidate != null) out.push(candidate);
  }
  return out;
}

function EmptyHint({ message }: { message: string }) {
  return (
    <Card tone="soft" padding="md">
      <Text variant="caption" color="textMuted">
        {message}
      </Text>
    </Card>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metric}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <View style={styles.metricValue}>
        <Text variant="heading3">{value}</Text>
        <Text variant="caption" color="textMuted">
          {unit}
        </Text>
      </View>
    </View>
  );
}

function MetricDivider() {
  return <View style={styles.metricDivider} />;
}

const styles = StyleSheet.create((theme) => ({
  flow: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  gutter: {
    paddingHorizontal: theme.spacing.lg,
  },
  intro: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.xxs,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metric: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  metricValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.xxs,
  },
  metricDivider: {
    width: 1,
    height: 28,
    marginHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.border,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  gridItem: {
    width: '48%',
    gap: theme.spacing.xxs,
  },
  gridCaption: {
    gap: 2,
  },
  list: {
    gap: theme.spacing.sm,
  },
  linkActions: {
    gap: theme.spacing.sm,
  },
  highlightHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
  },
  quote: {
    marginTop: theme.spacing.xs,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xxs,
    marginTop: theme.spacing.xs,
  },
  askHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  askDesc: {
    marginTop: theme.spacing.xxs,
    marginBottom: theme.spacing.sm,
  },
}));
