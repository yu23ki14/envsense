/**
 * ListRow — アイコン + タイトル + 補足 + 右側の値 + シェブロンの行。
 *
 * 設定リストや一覧の行に使う。`onPress` を渡すと押下可能になり、既定で
 * シェブロンを表示する。
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Icon, type IconName, Text } from '../ui';

export type ListRowProps = {
  /** 左端に表示するアイコン（角丸ボックス入り）。 */
  icon?: IconName;
  title: string;
  description?: string;
  /** 右側に表示する値テキスト。 */
  value?: string;
  /** 右側のカスタムスロット。シェブロンより前に置かれる。 */
  accessory?: ReactNode;
  /** 右端のシェブロン表示。既定は onPress があれば true。 */
  showChevron?: boolean;
  onPress?: () => void;
};

export function ListRow({
  icon,
  title,
  description,
  value,
  accessory,
  showChevron,
  onPress,
}: ListRowProps) {
  const chevron = showChevron ?? onPress != null;

  const content = (
    <>
      {icon ? (
        <View style={styles.iconBox}>
          <Icon name={icon} size={20} color="textMuted" />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="label">{title}</Text>
        {description ? (
          <Text variant="caption" color="textMuted">
            {description}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" color="textMuted">
          {value}
        </Text>
      ) : null}
      {accessory}
      {chevron ? <Icon name="chevronRight" size={18} color="textDisabled" /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: theme.radius[8],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
}));
