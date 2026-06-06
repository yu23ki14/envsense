/**
 * ClipPhoto — デバイスが撮影した写真を表示する。
 *
 * 保存済み JPEG を file URI から読み、`rotationDeg`(ファーム由来の向き)を
 * 回転で補正して描画する。枠は正方形(既定)で overflow hidden により角丸に
 * クリップされる。実画像が無い場面は {@link PhotoPlaceholder} を使う。
 */
import { Image, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { absoluteUri, type Photo } from '../data';

export type ClipPhotoProps = {
  photo: Photo;
  /** 角丸。既定 12。 */
  radius?: number;
  /** 縦横比。既定 1(正方形)。 */
  aspectRatio?: number;
};

export function ClipPhoto({ photo, radius = 12, aspectRatio = 1 }: ClipPhotoProps) {
  return (
    <View style={[styles.box, { borderRadius: radius, aspectRatio }]}>
      <Image
        source={{ uri: absoluteUri(photo.filePath) }}
        style={[styles.image, { transform: [{ rotate: `${photo.rotationDeg}deg` }] }]}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceMuted,
  },
  image: {
    width: '100%',
    height: '100%',
  },
}));
