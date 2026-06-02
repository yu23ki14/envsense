/**
 * RecordScreen — 「記録」タブの本体。
 *
 * 検索 + 期間フィルタの上に、過去の日々をカードで一覧する。各カードを
 * タップすると `/journal` モーダルへ遷移する（MVP では同じダミー画面）。
 */
import { router } from 'expo-router';
import { useState } from 'react';
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
import { Icon, Text, TextField } from '../ui';

type Range = 'week' | 'month' | 'all';

const THUMB_SLOTS = ['a', 'b', 'c', 'd'];

const RANGE_OPTIONS: SegmentedControlOption<Range>[] = [
  { value: 'week', label: '今週' },
  { value: 'month', label: '今月' },
  { value: 'all', label: 'すべて' },
];

const DAYS = [
  {
    id: '2026-06-01',
    date: '6 月 1 日 月',
    label: '昨日',
    sessions: 4,
    audio: '1:24',
    tags: ['#仕事', '#散歩'],
  },
  {
    id: '2026-05-31',
    date: '5 月 31 日 日',
    label: 'おととい',
    sessions: 2,
    audio: '0:38',
    tags: ['#休日'],
  },
  {
    id: '2026-05-30',
    date: '5 月 30 日 土',
    label: null,
    sessions: 5,
    audio: '2:10',
    tags: ['#旅行', '#外出'],
  },
  {
    id: '2026-05-29',
    date: '5 月 29 日 金',
    label: null,
    sessions: 3,
    audio: '1:05',
    tags: ['#仕事'],
  },
];

export function RecordScreen() {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range>('week');

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

        <SectionHeader kicker={`${DAYS.length} 件`} title="日々のクリップ" />

        <View style={styles.list}>
          {DAYS.map((day) => (
            <Card key={day.id} onPress={() => router.push('/journal')}>
              <View style={styles.dayHeader}>
                <View style={styles.dayHeaderTexts}>
                  <Text variant="label" weight="bold">
                    {day.date}
                  </Text>
                  {day.label ? (
                    <Text variant="caption" color="textMuted">
                      {day.label}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevronRight" size={18} color="textDisabled" />
              </View>
              <View style={styles.thumbRow}>
                {THUMB_SLOTS.map((slot) => (
                  <View key={slot} style={styles.thumb}>
                    <PhotoPlaceholder aspectRatio={1} radius={8} />
                  </View>
                ))}
              </View>
              <View style={styles.dayMeta}>
                <View style={styles.metaItem}>
                  <Icon name="image" size={14} color="textMuted" />
                  <Text variant="caption" color="textMuted">{`${day.sessions} セッション`}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Icon name="mic" size={14} color="textMuted" />
                  <Text variant="caption" color="textMuted">
                    {day.audio}
                  </Text>
                </View>
              </View>
              <View style={styles.tagRow}>
                {day.tags.map((t) => (
                  <Tag key={t} label={t} />
                ))}
              </View>
            </Card>
          ))}
        </View>
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
