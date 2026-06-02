/**
 * PhotoPlaceholder — 写真ブロックのプレースホルダ。
 *
 * MVP 段階では実画像を扱わないため、各画面の写真枠はこれで表現する。
 */
import { type DimensionValue, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Icon } from '../ui';

export type PhotoPlaceholderProps = {
  /** 幅。既定 '100%'。 */
  width?: DimensionValue;
  /** 高さ。未指定なら aspectRatio で決まる。 */
  height?: DimensionValue;
  /** 縦横比。height 未指定時に使う。既定 1。 */
  aspectRatio?: number;
  /** 角丸。既定 12。 */
  radius?: number;
};

export function PhotoPlaceholder({
  width = '100%',
  height,
  aspectRatio = 1,
  radius = 12,
}: PhotoPlaceholderProps) {
  return (
    <View
      style={[
        styles.box,
        { width, borderRadius: radius, ...(height != null ? { height } : { aspectRatio }) },
      ]}
    >
      <Icon name="image" size={24} color="textDisabled" />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
