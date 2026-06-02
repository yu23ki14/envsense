/**
 * TodayScreen — 「今日」タブの本体。
 *
 * 今日の活動サマリー、スナップショットグリッド、ハイライト引用、
 * エージェントへの質問 CTA を縦に並べる。MVP のためデータはダミー。
 */
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ClipScreen, PhotoPlaceholder, SectionHeader, Tag } from '../components';
import { Button, Icon, Text } from '../ui';

const SNAPSHOTS = [
  { time: '08:14', caption: '朝のコーヒー' },
  { time: '10:32', caption: 'オフィスに到着' },
  { time: '13:05', caption: '会議室 B のホワイトボード' },
  { time: '17:48', caption: '帰り道の桜並木' },
];

const HIGHLIGHTS = [
  {
    id: 'h1',
    time: '11:20',
    quote: '次のリリースのスコープは木曜の MTG で固める。先に粗いドラフトを共有しておくこと。',
    tags: ['#仕事', '#決定'],
  },
  {
    id: 'h2',
    time: '15:42',
    quote: '帰りに本屋に寄ること。Tufte の本が新装版で出ているらしい。',
    tags: ['#メモ'],
  },
];

export function TodayScreen() {
  return (
    <ClipScreen>
      <View style={styles.flow}>
        <View style={styles.intro}>
          <Text variant="caption" color="textMuted">
            2026 年 6 月 2 日 火曜日
          </Text>
          <Text variant="heading1">今日のクリップ</Text>
        </View>

        <View style={styles.gutter}>
          <Card>
            <View style={styles.metrics}>
              <Metric label="写真" value="24" unit="枚" />
              <MetricDivider />
              <Metric label="録音" value="1:12" unit="時間" />
              <MetricDivider />
              <Metric label="ハイライト" value="6" unit="件" />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="スナップショット" title="今日の眺め" />
        <View style={styles.gutter}>
          <View style={styles.grid}>
            {SNAPSHOTS.map((shot) => (
              <View key={shot.time} style={styles.gridItem}>
                <PhotoPlaceholder aspectRatio={1} radius={12} />
                <View style={styles.gridCaption}>
                  <Text variant="caption" weight="bold">
                    {shot.time}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {shot.caption}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <SectionHeader
          kicker="文字起こし"
          title="ハイライト"
          action={
            <Text variant="caption" color="link">
              すべて見る
            </Text>
          }
        />
        <View style={[styles.gutter, styles.list]}>
          {HIGHLIGHTS.map((h) => (
            <Card key={h.id}>
              <View style={styles.highlightHead}>
                <Icon name="spark" size={14} color="textMuted" />
                <Text variant="caption" color="textMuted">
                  {h.time}
                </Text>
              </View>
              <Text variant="body" style={styles.quote}>
                {h.quote}
              </Text>
              <View style={styles.tagRow}>
                {h.tags.map((t) => (
                  <Tag key={t} label={t} />
                ))}
              </View>
            </Card>
          ))}
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
