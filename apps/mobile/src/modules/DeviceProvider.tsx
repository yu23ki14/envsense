/**
 * 単一の BLE 接続をアプリ全体で共有するプロバイダ。
 * 取得した写真 / 音声は MMKV repo に逐次書き込まれる。
 */
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { BleDevice } from './ble';
import { type DeviceStatus, useDevice } from './useDevice';
import { useDeviceCapture } from './useDeviceCapture';

type DeviceContextValue = {
  device: BleDevice | null;
  status: DeviceStatus;
  connect: () => Promise<void>;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [device, connect, status] = useDevice();
  useDeviceCapture(device);
  const value = useMemo<DeviceContextValue>(
    () => ({ device, status, connect }),
    [device, status, connect],
  );
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (ctx == null) throw new Error('useDeviceContext must be used inside DeviceProvider');
  return ctx;
}
