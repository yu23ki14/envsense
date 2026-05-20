import * as React from 'react';
import { storageGet, storageRemove, storageSet } from '../utils/storage';
import { type BleDevice, bleClient } from './ble';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const DEVICE_ID_STORAGE_KEY = 'envsense.deviceId';
const REQUEST_OPTS = {
  name: 'envsense',
  services: [ENVSENSE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
};

export type DeviceStatus = {
  isConnecting: boolean;
  isAutoConnecting: boolean;
};

export function useDevice(): [BleDevice | null, () => Promise<void>, DeviceStatus] {
  const [device, setDevice] = React.useState<BleDevice | null>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = React.useState(true);

  const attachDevice = React.useCallback((d: BleDevice) => {
    d.onDisconnect(() => {
      console.log('Device disconnected');
      setDevice(null);
    });
    setDevice(d);
  }, []);

  // Try to reconnect to the last-seen device on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedId = await storageGet(DEVICE_ID_STORAGE_KEY);
        if (!savedId) return;
        console.log('Trying auto-reconnect to', savedId);
        const d = await bleClient.tryAutoConnect(REQUEST_OPTS, savedId);
        if (cancelled) return;
        if (d) {
          console.log('Auto-reconnect succeeded', d.id);
          attachDevice(d);
        } else {
          console.log('Auto-reconnect failed; falling back to manual scan');
        }
      } catch (e) {
        console.warn('Auto-reconnect threw', e);
      } finally {
        if (!cancelled) setIsAutoConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachDevice]);

  const doConnect = React.useCallback(async () => {
    setIsConnecting(true);
    try {
      console.log('Requesting device connection...');
      const d = await bleClient.requestDevice(REQUEST_OPTS);
      console.log('Connected successfully!', d.id);
      await storageSet(DEVICE_ID_STORAGE_KEY, d.id);
      attachDevice(d);
    } catch (e) {
      console.error('Connection failed:', e);
      // If the saved ID is what kept us from connecting, drop it so
      // the next manual attempt can pair with a different device.
      await storageRemove(DEVICE_ID_STORAGE_KEY);
    } finally {
      setIsConnecting(false);
    }
  }, [attachDevice]);

  return [device, doConnect, { isConnecting, isAutoConnecting }];
}
