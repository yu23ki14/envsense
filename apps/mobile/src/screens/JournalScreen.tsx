/**
 * JournalScreen — 「日別ジャーナル」モーダルの本体。
 *
 * URL パラメータ `date` (yyyy-MM-dd) の Day を読み出し、サマリー / 写真 /
 * ハイライト / タイムラインを表示する。
 */
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ModalScreen, PhotoPlaceholder, SectionHeader, Tag } from '../components';
import { dateKey, useDay, useHighlightsForDay, usePhotosForDay, useTimelineForDay } from '../data';
import { Icon, Text } from '../ui';

const PHOTO_GRID_LIMIT = 12;

function formatDate(date: Date): string {
  return format(date, 'M 月 d 日 EEEE', { locale: ja });
}

function relativeSubtitle(date: Date, now: Date): string {
  const diff = differenceInCalendarDays(now, date);
  if (diff === 0) return '今日のクリップ';
  if (diff === 1) return '昨日のクリップ';
  if (diff === 2) return 'おとといのクリップ';
  return `${diff} 日前のクリップ`;
}

function formatClock(ms: number): string {
  return format(ms, 'HH:mm');
}

function formatDurationFromMs(totalMs: number): string {
  const minutes = Math.floor(totalMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hours}:${mm.toString().padStart(2, '0')}`;
}

export function JournalScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const now = useMemo(() => new Date(), []);
  const resolvedDate = useMemo(
    () =>
      typeof params.date === 'string' && params.date.length > 0
        ? params.date
        : dateKey(now.getTime()),
    [params.date, now],
  );
  const dateObj = useMemo(() => parseISO(resolvedDate), [resolvedDate]);

  const day = useDay(resolvedDate);
  const photos = usePhotosForDay(resolvedDate);
  const highlights = useHighlightsForDay(resolvedDate);
  const timeline = useTimelineForDay(resolvedDate);

  const photoCount = photos.length;
  const audioTotalMs = day?.audioTotalMs ?? 0;
  const highlightCount = highlights.length;
  const gridPhotos = useMemo(() => photos.slice(0, PHOTO_GRID_LIMIT), [photos]);

  return (
    <ModalScreen
      title={formatDate(dateObj)}
      subtitle={relativeSubtitle(dateObj, now)}
      headerRight={
        <View style={styles.headerActions}>
          <Icon name="share" size={20} color="text" />
        </View>
      }
    >
      <View style={styles.flow}>
        <View style={styles.gutter}>
          <Card>
            <View style={styles.summaryRow}>
              <SummaryItem label="写真" value={String(photoCount)} />
              <SummaryDivider />
              <SummaryItem label="録音" value={formatDurationFromMs(audioTotalMs)} />
              <SummaryDivider />
              <SummaryItem label="ハイライト" value={String(highlightCount)} />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="写真" title="その日の眺め" />
        <View style={styles.gutter}>
          {gridPhotos.length === 0 ? (
            <Card tone="soft" padding="md">
              <Text variant="caption" color="textMuted">
                この日の写真はまだありません。
              </Text>
            </Card>
          ) : (
            <View style={styles.grid}>
              {gridPhotos.map((p) => (
                <View key={p.id} style={styles.gridItem}>
                  <PhotoPlaceholder aspectRatio={1} radius={10} />
                </View>
              ))}
            </View>
          )}
        </View>

        <SectionHeader kicker="文字起こし" title="ハイライト" />
        <View style={[styles.gutter, styles.list]}>
          {highlights.length === 0 ? (
            <Card tone="soft" padding="md">
              <Text variant="caption" color="textMuted">
                ハイライトはまだ抽出されていません。
              </Text>
            </Card>
          ) : (
            highlights.map((h) => (
              <Card key={h.id}>
                <View style={styles.cardHead}>
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

        <SectionHeader kicker="一日の流れ" title="タイムライン" />
        <View style={styles.gutter}>
          {timeline.length === 0 ? (
            <Card tone="soft" padding="md">
              <Text variant="caption" color="textMuted">
                タイムラインはまだ生成されていません。
              </Text>
            </Card>
          ) : (
            <View style={styles.timeline}>
              {timeline.map((event, index) => (
                <View key={event.id} style={styles.timelineRow}>
                  <View style={styles.timelineRail}>
                    <View style={styles.timelineDot} />
                    {index < timeline.length - 1 ? <View style={styles.timelineLine} /> : null}
                  </View>
                  <View style={styles.timelineBody}>
                    <Text variant="caption" color="textMuted">
                      {formatClock(event.bucketAt)}
                    </Text>
                    <Text variant="label" weight="bold">
                      {event.title}
                    </Text>
                    {event.snippet.length > 0 ? (
                      <Text variant="caption" color="textMuted">
                        {event.snippet}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </ModalScreen>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="heading3">{value}</Text>
    </View>
  );
}

function SummaryDivider() {
  return <View style={styles.summaryDivider} />;
}

const styles = StyleSheet.create((theme) => ({
  flow: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  gutter: {
    paddingHorizontal: theme.spacing.lg,
  },
  headerActions: {
    paddingHorizontal: theme.spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    marginHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.border,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  gridItem: {
    width: '31.5%',
  },
  list: {
    gap: theme.spacing.sm,
  },
  cardHead: {
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
  timeline: {
    gap: theme.spacing.md,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  timelineRail: {
    width: 12,
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
    marginTop: 4,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: theme.colors.border,
    marginTop: 2,
  },
  timelineBody: {
    flex: 1,
    gap: 2,
  },
}));
