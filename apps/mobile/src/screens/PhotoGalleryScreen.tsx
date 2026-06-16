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
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { Card, ClipPhoto, ConfirmModal, ModalScreen } from '../components';
import { absoluteUri, dateKey, deletePhoto, type Photo, usePhotosForDay } from '../data';
import { Button, Icon, Text } from '../ui';

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

  const insets = useSafeAreaInsets();
  const photos = usePhotosForDay(resolvedDate);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmVisible, setConfirmVisible] = useState(false);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePress = useCallback(
    (index: number, id: string) => {
      if (selecting) toggle(id);
      else setViewerIndex(index);
    },
    [selecting, toggle],
  );

  const handleLongPress = useCallback(
    (id: string) => {
      if (selecting) return;
      setSelecting(true);
      setSelected(new Set([id]));
    },
    [selecting],
  );

  const confirmDelete = useCallback(() => {
    for (const id of selected) deletePhoto(id);
    setConfirmVisible(false);
    exitSelection();
  }, [selected, exitSelection]);

  const subtitle = selecting ? `${selected.size} 枚を選択中` : `全 ${photos.length} 枚の写真`;

  const headerRight =
    photos.length === 0 ? null : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selecting ? '選択をキャンセル' : '写真を選択'}
        onPress={selecting ? exitSelection : () => setSelecting(true)}
        hitSlop={8}
      >
        <Text variant="label" weight="bold" color="link">
          {selecting ? 'キャンセル' : '選択'}
        </Text>
      </Pressable>
    );

  return (
    <ModalScreen
      title={formatDate(dateObj)}
      subtitle={subtitle}
      scrollable={false}
      headerRight={headerRight}
      onClose={selecting ? exitSelection : undefined}
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
          contentContainerStyle={[styles.gridContent, selecting && styles.gridContentSelecting]}
          renderItem={({ item, index }) => {
            const isSelected = selected.has(item.id);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={selecting ? { selected: isSelected } : undefined}
                accessibilityLabel={
                  selecting
                    ? `${formatClock(item.capturedAt)} の写真を${isSelected ? '選択解除' : '選択'}`
                    : `${formatClock(item.capturedAt)} の写真を全画面で見る`
                }
                onPress={() => handlePress(index, item.id)}
                onLongPress={() => handleLongPress(item.id)}
                style={styles.gridItem}
              >
                <ClipPhoto photo={item} radius={10} />
                {selecting ? (
                  <View
                    style={[styles.selectOverlay, isSelected && styles.selectOverlaySelected]}
                    pointerEvents="none"
                  >
                    <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                      {isSelected ? <Icon name="check" size={16} color="onPrimary" /> : null}
                    </View>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
      {selecting ? (
        <View style={[styles.deleteBar, { paddingBottom: insets.bottom + 12 }]}>
          <Button
            variant="solid"
            disabled={selected.size === 0}
            iconLeft={<Icon name="trash" size={18} color="onPrimary" />}
            onPress={() => setConfirmVisible(true)}
          >
            {selected.size > 0 ? `${selected.size} 枚を削除` : '削除する写真を選択'}
          </Button>
        </View>
      ) : null}
      <ConfirmModal
        visible={confirmVisible}
        title="写真を削除"
        message={`選択した ${selected.size} 枚を削除します。AI による説明文など、紐づくデータも削除されます。この操作は取り消せません。`}
        confirmLabel="削除"
        onConfirm={confirmDelete}
        onClose={() => setConfirmVisible(false)}
      />
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
  // 削除バーに本文が隠れないよう、選択中はグリッド下部の余白を広げる。
  gridContentSelecting: {
    paddingBottom: theme.spacing.xxl * 2,
  },
  selectOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'flex-end',
    padding: theme.spacing.xxs,
  },
  selectOverlaySelected: {
    borderColor: theme.colors.primary,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.surface,
    backgroundColor: theme.colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  deleteBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
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
