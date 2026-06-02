/**
 * ClipTabBar — ボトムタブナビゲーションのカスタムタブバー。
 *
 * expo-router の Tabs（app/(tabs)/_layout.tsx）から `tabBar` prop 経由で
 * 描画される。ルート名（index / record / device）からラベルとアイコンを引く。
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Icon, type IconName, Text } from '../ui';

type TabMeta = { label: string; icon: IconName };

/** ルート名 → タブのラベルとアイコン。 */
const TAB_META: Record<string, TabMeta> = {
  index: { label: '今日', icon: 'home' },
  record: { label: '記録', icon: 'record' },
  device: { label: 'デバイス', icon: 'device' },
};

export function ClipTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) {
          return null;
        }
        const focused = state.index === index;
        const tone = focused ? 'primary' : 'textMuted';

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            onPress={onPress}
            style={styles.item}
          >
            <Icon name={meta.icon} size={22} color={tone} />
            <Text variant="caption" style={{ color: theme.colors[tone] }}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.xxs,
  },
}));
