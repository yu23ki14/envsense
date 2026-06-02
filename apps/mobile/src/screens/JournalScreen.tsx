/**
 * JournalScreen — 「日別ジャーナル」モーダルの本体。
 *
 * 指定された日のサマリー、写真グリッド、ハイライト、タイムラインを表示する。
 * MVP のためデータはダミーで、URL パラメータからの日付解決は別 Issue。
 */
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ModalScreen, PhotoPlaceholder, SectionHeader, Tag } from '../components';
import { Icon, Text } from '../ui';

const PHOTO_SLOTS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

const HIGHLIGHTS = [
  {
    id: 'h1',
    time: '09:14',
    quote: '朝の散歩でいつもの公園。アジサイが色づきはじめている。',
    tags: ['#散歩', '#季節'],
  },
  {
    id: 'h2',
    time: '14:42',
    quote: '次の打ち合わせは木曜 10 時。資料の構成だけ先にラフを送る。',
    tags: ['#仕事'],
  },
];

const TIMELINE = [
  {
    id: 't1',
    time: '08:30',
    title: '家を出る',
    snippet: '今日は涼しい。上着を持って行こうか迷う。',
  },
  {
    id: 't2',
    time: '10:05',
    title: 'オフィス到着',
    snippet: '受付前で同僚に会う。新プロジェクトの話を少し。',
  },
  {
    id: 't3',
    time: '12:18',
    title: 'ランチ',
    snippet: '近所のカレー屋。次は別の店も試してみたい。',
  },
  {
    id: 't4',
    time: '17:50',
    title: '帰路',
    snippet: '駅前の本屋に寄る。気になっていた本を見つけた。',
  },
];

export function JournalScreen() {
  return (
    <ModalScreen
      title="6 月 1 日 月曜日"
      subtitle="昨日のクリップ"
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
              <SummaryItem label="写真" value="32" />
              <SummaryDivider />
              <SummaryItem label="録音" value="1:24" />
              <SummaryDivider />
              <SummaryItem label="ハイライト" value="4" />
            </View>
          </Card>
        </View>

        <SectionHeader kicker="写真" title="その日の眺め" />
        <View style={styles.gutter}>
          <View style={styles.grid}>
            {PHOTO_SLOTS.map((slot) => (
              <View key={slot} style={styles.gridItem}>
                <PhotoPlaceholder aspectRatio={1} radius={10} />
              </View>
            ))}
          </View>
        </View>

        <SectionHeader kicker="文字起こし" title="ハイライト" />
        <View style={[styles.gutter, styles.list]}>
          {HIGHLIGHTS.map((h) => (
            <Card key={h.id}>
              <View style={styles.cardHead}>
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

        <SectionHeader kicker="一日の流れ" title="タイムライン" />
        <View style={styles.gutter}>
          <View style={styles.timeline}>
            {TIMELINE.map((event, index) => (
              <View key={event.id} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={styles.timelineDot} />
                  {index < TIMELINE.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <View style={styles.timelineBody}>
                  <Text variant="caption" color="textMuted">
                    {event.time}
                  </Text>
                  <Text variant="label" weight="bold">
                    {event.title}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {event.snippet}
                  </Text>
                </View>
              </View>
            ))}
          </View>
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
