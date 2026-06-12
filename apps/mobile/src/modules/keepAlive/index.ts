/**
 * keepAlive — デバイス接続中の BLE キャプチャをバックグラウンドでも継続させる。
 *
 * Android では connectedDevice フォアグラウンドサービス + 常駐通知を立てて
 * プロセス kill を防ぐ（keepAlive.native.ts）。web は no-op。BLE 層と同じく
 * 動的 import でプラットフォーム実装を遅延ロードし、web バンドルに notifee の
 * ネイティブブリッジが入らないようにする。
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { KeepAlive } from './types';

let _implPromise: Promise<KeepAlive> | null = null;
function getImpl(): Promise<KeepAlive> {
  if (_implPromise) return _implPromise;
  _implPromise = (
    Platform.OS === 'web' ? import('./keepAlive.web') : import('./keepAlive.native')
  ).then((m) => m.keepAlive);
  return _implPromise;
}

/** デバイス接続中（connected = true の間）だけフォアグラウンドサービスを立てる。 */
export function useDeviceKeepAlive(connected: boolean): void {
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    getImpl()
      .then((impl) => (cancelled ? undefined : impl.start()))
      .catch((err) => console.warn('Keep-alive start failed', err));
    return () => {
      cancelled = true;
      getImpl()
        .then((impl) => impl.stop())
        .catch((err) => console.warn('Keep-alive stop failed', err));
    };
  }, [connected]);
}

export type { KeepAlive } from './types';
