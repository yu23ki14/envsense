/**
 * 単一の BLE 接続をアプリ全体で共有するプロバイダ。
 * 取得した写真 / 音声は MMKV repo に逐次書き込まれる。
 * microSD 同期（未同期状況・手動同期の実行）もここで一元管理する。
 */
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { usePairedDevice } from '../data';
import type { BleDevice } from './ble';
import { useDeviceKeepAlive } from './keepAlive';
import { type DeviceStatus, useDevice } from './useDevice';
import { useDeviceCapture } from './useDeviceCapture';
import { type DeviceSyncState, useDeviceSync } from './useDeviceSync';

type DeviceContextValue = {
  device: BleDevice | null;
  status: DeviceStatus;
  sync: DeviceSyncState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [device, connect, disconnect, status] = useDevice();
  useDeviceCapture(device);
  useDeviceKeepAlive(device != null);
  const sync = useDeviceSync(device);
  const value = useMemo<DeviceContextValue>(
    () => ({ device, status, sync, connect, disconnect }),
    [device, status, sync, connect, disconnect],
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
