/**
 * ConfirmModal — 実行前にひと呼吸置きたい操作（デバイスのスリープなど）の
 * 汎用確認モーダル。追加のネイティブ依存を避けるため RN の `Modal` で実装する
 * （SettingSelectModal と同方針）。
 */
import { Modal, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button, Text } from '../ui';

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  message: string;
  /** 実行ボタンのラベル（例: 「スリープ」）。 */
  confirmLabel: string;
  /** 実行中インジケータ。true の間は実行ボタンが loading になる。 */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.texts}>
            <Text variant="label" weight="bold">
              {title}
            </Text>
            <Text variant="body" color="textMuted">
              {message}
            </Text>
          </View>
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button variant="outline" onPress={onClose}>
                キャンセル
              </Button>
            </View>
            <View style={styles.actionButton}>
              <Button onPress={onConfirm} loading={busy}>
                {confirmLabel}
              </Button>
            </View>
          </View>
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
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  texts: {
    gap: theme.spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
}));
