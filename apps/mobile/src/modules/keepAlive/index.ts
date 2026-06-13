/**
 * keepAlive — BLE キャプチャと同期後処理をバックグラウンドでも継続させる。
 *
 * Android では connectedDevice フォアグラウンドサービス + 常駐通知を立てて
 * プロセス kill を防ぐ（keepAlive.native.ts）。対象は「デバイス接続中」に加え、
 * 切断後も続く処理（microSD 同期・文字起こしキュー・再開処理 = backgroundWork）。
 * web は no-op。BLE 層と同じく動的 import でプラットフォーム実装を遅延ロードし、
 * web バンドルに notifee のネイティブブリッジが入らないようにする。
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useBackgroundWorkActive } from '../backgroundWork';
import type { KeepAlive, KeepAliveNotification } from './types';

let _implPromise: Promise<KeepAlive> | null = null;
function getImpl(): Promise<KeepAlive> {
  if (_implPromise) return _implPromise;
  _implPromise = (
    Platform.OS === 'web' ? import('./keepAlive.web') : import('./keepAlive.native')
  ).then((m) => m.keepAlive);
  return _implPromise;
}

// start / stop は非同期なので、effect の再実行で停止と開始が前後しないよう
// 1 本のキューで直列化する（最後に積んだ操作の状態が最終状態になる）。
let opQueue: Promise<unknown> = Promise.resolve();
function enqueue(op: (impl: KeepAlive) => Promise<void>): void {
  opQueue = opQueue
    .then(getImpl)
    .then(op)
    .catch((err) => console.warn('Keep-alive operation failed', err));
}

/**
 * デバイス接続中、またはバックグラウンド処理（同期 / 文字起こし）の実行中だけ
 * フォアグラウンドサービスを立てる。通知の文言は状態に合わせて切り替える。
 */
export function useDeviceKeepAlive(connected: boolean): void {
  const busy = useBackgroundWorkActive();
  const active = connected || busy;

  useEffect(() => {
    if (!active) return;
    const notification: KeepAliveNotification = connected
      ? { title: 'envsense と接続中', body: '写真と音声を記録しています' }
      : { title: 'envsense', body: '記録データを処理しています' };
    enqueue((impl) => impl.start(notification));
    return () => enqueue((impl) => impl.stop());
  }, [active, connected]);
}

export type { KeepAlive, KeepAliveNotification } from './types';
