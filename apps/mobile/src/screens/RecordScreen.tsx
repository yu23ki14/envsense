/**
 * RecordScreen — 「記録」タブの本体。
 *
 * 検索 + 期間フィルタの上に、過去の日々をカードで一覧する。各カードを
 * タップすると `/journal` モーダルへ遷移する。Day ロールアップを MMKV から読み出す。
 */
import { differenceInCalendarDays, format, isAfter, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
  Card,
  ClipScreen,
  PhotoPlaceholder,
  SectionHeader,
  SegmentedControl,
  type SegmentedControlOption,
  Tag,
} from '../components';
import type { Day } from '../data';
import { useDaysList } from '../data';
import { Icon, Text, TextField } from '../ui';

type Range = 'week' | 'month' | 'all';

const RANGE_OPTIONS: SegmentedControlOption<Range>[] = [
  { value: 'week', label: '今週' },
  { value: 'month', label: '今月' },
  { value: 'all', label: 'すべて' },
];

const THUMB_COUNT = 4;

function relativeLabel(date: Date, now: Date): string | null {
  const diff = differenceInCalendarDays(now, date);
  if (diff === 1) return '昨日';
  if (diff === 2) return 'おととい';
  return null;
}

function formatDayHeader(date: Date): string {
  return format(date, 'M 月 d 日 EEE', { locale: ja });
}

function formatDurationFromMs(totalMs: number): string {
  const minutes = Math.floor(totalMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hours}:${mm.toString().padStart(2, '0')}`;
}

function topTags(day: Day, max: number): string[] {
  const entries = Object.entries(day.tagFrequencies);
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, max).map(([tag]) => tag);
}

function matchesQuery(day: Day, q: string): boolean {
  if (q.length === 0) return true;
  if (day.date.includes(q)) return true;
  return Object.keys(day.tagFrequencies).some((t) => t.includes(q));
}

function inRange(day: Day, range: Range, now: Date): boolean {
  if (range === 'all') return true;
  const parsed = parseISO(day.date);
  if (range === 'week') return isAfter(parsed, subDays(now, 7));
  return isAfter(parsed, subDays(now, 30));
}

export function RecordScreen() {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range>('week');
  const days = useDaysList();

  const now = useMemo(() => new Date(), []);
  const filtered = useMemo(
    () => days.filter((d) => inRange(d, range, now) && matchesQuery(d, query)),
    [days, range, now, query],
  );

  return (
    <ClipScreen>
      <View style={styles.flow}>
        <View style={styles.header}>
          <Text variant="heading2">記録</Text>
          <Text variant="caption" color="textMuted">
            これまでの日々を遡る
          </Text>
        </View>

        <View style={styles.controls}>
          <TextField placeholder="日付・タグ・キーワード" value={query} onChangeText={setQuery} />
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </View>

        <SectionHeader kicker={`${filtered.length} 件`} title="日々のクリップ" />

        {filtered.length === 0 ? (
          <View style={styles.list}>
            <Card tone="soft" padding="md">
              <Text variant="caption" color="textMuted">
                該当する日がまだありません。デバイスを接続し、撮影と録音が記録されると一覧に並びます。
              </Text>
            </Card>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((day) => {
              const dayDate = parseISO(day.date);
              const label = relativeLabel(dayDate, now);
              const tags = topTags(day, 3);
              const thumbIds = day.coverPhotoIds.slice(0, THUMB_COUNT);
              return (
                <Card
                  key={day.date}
                  onPress={() => router.push({ pathname: '/journal', params: { date: day.date } })}
                >
                  <View style={styles.dayHeader}>
                    <View style={styles.dayHeaderTexts}>
                      <Text variant="label" weight="bold">
                        {formatDayHeader(dayDate)}
                      </Text>
                      {label ? (
                        <Text variant="caption" color="textMuted">
                          {label}
                        </Text>
                      ) : null}
                    </View>
                    <Icon name="chevronRight" size={18} color="textDisabled" />
                  </View>
                  <View style={styles.thumbRow}>
                    {Array.from({ length: THUMB_COUNT }).map((_, i) => (
                      <View key={`${day.date}-thumb-${thumbIds[i] ?? i}`} style={styles.thumb}>
                        <PhotoPlaceholder aspectRatio={1} radius={8} />
                      </View>
                    ))}
                  </View>
                  <View style={styles.dayMeta}>
                    <View style={styles.metaItem}>
                      <Icon name="image" size={14} color="textMuted" />
                      <Text variant="caption" color="textMuted">
                        {`${day.sessionCount} セッション`}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Icon name="mic" size={14} color="textMuted" />
                      <Text variant="caption" color="textMuted">
                        {formatDurationFromMs(day.audioTotalMs)}
                      </Text>
                    </View>
                  </View>
                  {tags.length > 0 ? (
                    <View style={styles.tagRow}>
                      {tags.map((t) => (
                        <Tag key={t} label={`#${t}`} />
                      ))}
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </ClipScreen>
  );
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
  controls: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  list: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayHeaderTexts: {
    flex: 1,
    gap: 2,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: theme.spacing.xxs,
    marginTop: theme.spacing.sm,
  },
  thumb: {
    flex: 1,
  },
  dayMeta: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xxs,
    marginTop: theme.spacing.xs,
  },
}));
