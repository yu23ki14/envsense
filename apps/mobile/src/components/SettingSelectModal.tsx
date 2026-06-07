/**
 * SettingSelectModal — 設定行から開く汎用の単一選択モーダル。
 *
 * 選択肢は `group` 見出しでまとめて表示し、選択中の項目にはチェックを付ける。
 * 各項目に `note` を付けると補足（例: ローカルモデルのフォールバック注記）を出す。
 * 追加のネイティブ依存を避けるため RN の `Modal` で実装する（Select.tsx と同方針）。
 */
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Icon, Text } from '../ui';

export type SettingSelectOption<T extends string> = {
  value: T;
  label: string;
  /** 項目の下に出す補足テキスト。 */
  note?: string;
  /** セクション見出し。同じ文字列の項目がまとまる（出現順）。 */
  group?: string;
};

export type SettingSelectModalProps<T extends string> = {
  visible: boolean;
  title: string;
  options: SettingSelectOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  onClose: () => void;
};

export function SettingSelectModal<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: SettingSelectModalProps<T>) {
  // group ごとに出現順でまとめる。
  const groups: { group: string | undefined; items: SettingSelectOption<T>[] }[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last != null && last.group === option.group) {
      last.items.push(option);
    } else {
      groups.push({ group: option.group, items: [option] });
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text variant="label" weight="bold">
              {title}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose}>
              <Icon name="close" size={20} color="textMuted" />
            </Pressable>
          </View>
          <ScrollView style={styles.list}>
            {groups.map((section) => (
              <View key={section.group ?? '_'}>
                {section.group != null ? (
                  <Text variant="caption" color="textMuted" style={styles.groupHeading}>
                    {section.group}
                  </Text>
                ) : null}
                {section.items.map((option) => {
                  const selected = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        onSelect(option.value);
                        onClose();
                      }}
                      style={styles.row}
                    >
                      <View style={styles.rowTexts}>
                        <Text variant="body" color={selected ? 'link' : 'text'}>
                          {option.label}
                        </Text>
                        {option.note != null ? (
                          <Text variant="caption" color="textMuted">
                            {option.note}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? <Icon name="check" size={18} color="link" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius[12],
    maxHeight: '70%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  list: {
    paddingVertical: theme.spacing.xs,
  },
  groupHeading: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  rowTexts: {
    flex: 1,
    gap: 2,
  },
}));
