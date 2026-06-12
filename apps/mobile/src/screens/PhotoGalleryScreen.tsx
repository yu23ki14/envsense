/**
 * PhotoGalleryScreen — 「写真一覧」モーダルの本体。
 *
 * URL パラメータ `date` (yyyy-MM-dd) の日の全写真を 3 列グリッドで一覧表示し、
 * 1 枚タップすると全画面のスワイプビューア（時刻 + AI 説明のキャプション付き）に
 * 切り替わる。「今日」タブとジャーナルの写真タップから開かれる。
 */
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Card, ClipPhoto, ModalScreen } from '../components';
import { absoluteUri, dateKey, type Photo, usePhotosForDay } from '../data';
import { Icon, Text } from '../ui';

const GRID_COLUMNS = 3;

function formatDate(date: Date): string {
  return format(date, 'M 月 d 日 EEEE', { locale: ja });
}

function formatClock(ms: number): string {
  return format(ms, 'HH:mm');
}

export function PhotoGalleryScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const resolvedDate = useMemo(
    () =>
      typeof params.date === 'string' && params.date.length > 0 ? params.date : dateKey(Date.now()),
    [params.date],
  );
  const dateObj = useMemo(() => parseISO(resolvedDate), [resolvedDate]);

  const photos = usePhotosForDay(resolvedDate);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <ModalScreen
      title={formatDate(dateObj)}
      subtitle={`全 ${photos.length} 枚の写真`}
      scrollable={false}
    >
      {photos.length === 0 ? (
        <View style={styles.empty}>
          <Card tone="soft" padding="md">
            <Text variant="caption" color="textMuted">
              この日の写真はまだありません。
            </Text>
          </Card>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(p) => p.id}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${formatClock(item.capturedAt)} の写真を全画面で見る`}
              onPress={() => setViewerIndex(index)}
              style={styles.gridItem}
            >
              <ClipPhoto photo={item} radius={10} />
            </Pressable>
          )}
        />
      )}
      {viewerIndex != null ? (
        <PhotoPager
          photos={photos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </ModalScreen>
  );
}

type PhotoPagerProps = {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
};

/** 全画面のスワイプビューア。横ページングでその日の全写真を順送りできる。 */
function PhotoPager({ photos, initialIndex, onClose }: PhotoPagerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(initialIndex);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setCurrent(first.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const photo = photos[current];

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.viewerRoot}>
        <FlatList
          data={photos}
          keyExtractor={(p) => p.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item }) => <ViewerPage photo={item} width={width} height={height} />}
        />
        <View style={[styles.viewerHeader, { paddingTop: insets.top + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            onPress={onClose}
            style={styles.viewerClose}
          >
            <Icon name="close" size={24} color="onPrimary" />
          </Pressable>
          <Text variant="label" weight="bold" color="onPrimary">
            {current + 1} / {photos.length}
          </Text>
        </View>
        {photo != null ? (
          <View style={[styles.viewerCaption, { paddingBottom: insets.bottom + 16 }]}>
            <Text variant="label" weight="bold" color="onPrimary">
              {formatClock(photo.capturedAt)}
            </Text>
            {photo.description != null ? (
              <Text variant="caption" color="onPrimary" numberOfLines={2}>
                {photo.description}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

type ViewerPageProps = {
  photo: Photo;
  width: number;
  height: number;
};

function ViewerPage({ photo, width, height }: ViewerPageProps) {
  // rotationDeg が 90/270 のときは回転後に画面へ収まるよう幅と高さを入れ替えて描画する。
  const swapped = photo.rotationDeg === 90 || photo.rotationDeg === 270;
  return (
    <View style={[styles.viewerPage, { width, height }]}>
      <Image
        source={{ uri: absoluteUri(photo.filePath) }}
        style={{
          width: swapped ? height : width,
          height: swapped ? width : height,
          transform: [{ rotate: `${photo.rotationDeg}deg` }],
        }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  gridContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.xs,
  },
  gridRow: {
    gap: theme.spacing.xs,
  },
  gridItem: {
    width: '31.5%',
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: theme.colors.text,
  },
  viewerPage: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  viewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  viewerClose: {
    padding: theme.spacing.xs,
  },
  viewerCaption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.xxs,
  },
}));
