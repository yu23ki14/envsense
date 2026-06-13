/**
 * 単一の BLE 接続をアプリ全体で共有するプロバイダ。
 * 取得した写真 / 音声は MMKV repo に逐次書き込まれる。
 * microSD 同期（未同期状況・手動同期の実行）もここで一元管理する。
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { usePairedDevice } from '../data';
import type { BleDevice } from './ble';
import { useDeviceKeepAlive } from './keepAlive';
import { resumePendingTranscriptions } from './transcriptionBacklog';
import { type DeviceStatus, useDevice } from './useDevice';
import { useDeviceCapture } from './useDeviceCapture';
import { type DeviceModeState, useDeviceMode } from './useDeviceMode';
import { type DeviceSyncState, useDeviceSync } from './useDeviceSync';

type DeviceContextValue = {
  device: BleDevice | null;
  status: DeviceStatus;
  sync: DeviceSyncState;
  mode: DeviceModeState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [device, connect, disconnect, status] = useDevice();
  const mode = useDeviceMode(device);
  // ライブストリーミング経路はデバイスの実効モードに追従する（'local' へ切り替えると
  // 購読が解除され、'streaming' へ戻すと張り直される）。
  useDeviceCapture(device, mode.deviceMode);
  useDeviceKeepAlive(device != null);
  const sync = useDeviceSync(device);
  // 前回中断（アプリ kill・API 失敗）した文字起こしを起動時に自動再開する。
  useEffect(() => {
    void resumePendingTranscriptions();
  }, []);
  const value = useMemo<DeviceContextValue>(
    () => ({ device, status, sync, mode, connect, disconnect }),
    [device, status, sync, mode, connect, disconnect],
  );
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (ctx == null) throw new Error('useDeviceContext must be used inside DeviceProvider');
  return ctx;
}

/** ヘッダーのデバイスステータスチップ（ClipDeviceStatus）へ渡す実値。 */
export function useDeviceStatusChip(): {
  connection: 'connected' | 'disconnected';
  batteryPercent: number | null;
  unsyncedCount: number | null;
} {
  const { device, sync } = useDeviceContext();
  const paired = usePairedDevice();
  return {
    connection: device != null ? 'connected' : 'disconnected',
    batteryPercent: paired?.lastBatteryPercent ?? null,
    unsyncedCount: sync.status != null ? sync.status.audioFiles + sync.status.photoFiles : null,
  };
}
