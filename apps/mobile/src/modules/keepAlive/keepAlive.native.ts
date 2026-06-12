/**
 * keepAlive の native 実装（実体は Android 専用、iOS は no-op）。
 *
 * Android はバックグラウンドで数分経つと Doze / OEM の省電力キラーがアプリの
 * プロセスごと kill し、BLE キャプチャ（useDeviceCapture）が止まる。接続中だけ
 * notifee の connectedDevice フォアグラウンドサービス（常駐通知）を立てて
 * kill 対象から外す。iOS は UIBackgroundModes の bluetooth-central で足りる。
 */
import notifee, { AndroidForegroundServiceType, AndroidImportance } from '@notifee/react-native';
import { Alert, Platform } from 'react-native';
import { mmkv } from '../../data/storage/mmkv';
import type { KeepAlive } from './types';

const NOTIFICATION_ID = 'device-connection';
const CHANNEL_ID = 'device-connection';
// 電池最適化の除外誘導ダイアログは一度だけ出す。
const BATTERY_OPT_PROMPTED_KEY = 'keep-alive:battery-opt-prompted';

if (Platform.OS === 'android') {
  // サービス本体。stopForegroundService() まで生き続けるよう、意図的に resolve
  // しない Promise を返す。displayNotification より前に登録されている必要がある。
  notifee.registerForegroundService(() => new Promise(() => {}));
}

async function start(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Android 13+ の通知権限。拒否されてもサービス自体は動く（通知が見えないだけ）。
  await notifee.requestPermission();
  const channelId = await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'デバイス接続',
    importance: AndroidImportance.LOW,
  });
  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: 'envsense と接続中',
    body: '写真と音声を記録しています',
    android: {
      channelId,
      asForegroundService: true,
      foregroundServiceTypes: [
        AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
      ],
      ongoing: true,
      pressAction: { id: 'default' },
    },
  });
  await maybePromptBatteryOptimization();
}

async function stop(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.stopForegroundService();
  await notifee.cancelNotification(NOTIFICATION_ID);
}

/**
 * 電池最適化（バッテリーセーバー）が有効だと、フォアグラウンドサービスがあっても
 * Samsung 等の OEM はアプリを kill することがある。初回接続時に一度だけ除外設定へ誘導する。
 */
async function maybePromptBatteryOptimization(): Promise<void> {
  if (mmkv.getBoolean(BATTERY_OPT_PROMPTED_KEY) === true) return;
  const enabled = await notifee.isBatteryOptimizationEnabled();
  if (!enabled) return;
  mmkv.set(BATTERY_OPT_PROMPTED_KEY, true);
  Alert.alert(
    'バックグラウンド記録の安定化',
    '記録を安定して続けるため、envsense を電池の最適化の対象から除外することをおすすめします。',
    [
      { text: 'あとで', style: 'cancel' },
      { text: '設定を開く', onPress: () => void notifee.openBatteryOptimizationSettings() },
    ],
  );
}

export const keepAlive: KeepAlive = { start, stop };
