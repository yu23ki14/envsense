import * as React from 'react';
import { getPairedDevice, savePairedDevice } from '../data';
import { type BleDevice, bleClient } from './ble';

const ENVSENSE_SERVICE_UUID = 'ea800000-9c72-497f-81f9-752ffe11f565';
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const FIRMWARE_REVISION_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const REQUEST_OPTS = {
  name: 'envsense',
  services: [ENVSENSE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
};

export type DeviceStatus = {
  isConnecting: boolean;
  isAutoConnecting: boolean;
};

async function readFirmwareVersion(device: BleDevice): Promise<string> {
  const service = await device.getService(DEVICE_INFO_SERVICE_UUID);
  const char = await service.getCharacteristic(FIRMWARE_REVISION_UUID);
  const bytes = await char.read();
  return new TextDecoder().decode(bytes);
}

export function useDevice(): [BleDevice | null, () => Promise<void>, DeviceStatus] {
  const [device, setDevice] = React.useState<BleDevice | null>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = React.useState(true);

  const attachDevice = React.useCallback(async (d: BleDevice) => {
    d.onDisconnect(() => {
      console.log('Device disconnected');
      setDevice(null);
    });
    setDevice(d);
    const firmwareVersion = await readFirmwareVersion(d).catch((e) => {
      console.warn('Failed to read firmware version', e);
      return '0.0.0';
    });
    const now = Date.now();
    const existing = getPairedDevice();
    savePairedDevice({
      id: d.id,
      name: d.name ?? existing?.name ?? 'envsense',
      firmwareVersion,
      pairedAt: existing?.pairedAt ?? now,
      lastConnectedAt: now,
      lastBatteryPercent: existing?.lastBatteryPercent ?? null,
      lastRssi: existing?.lastRssi ?? null,
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const paired = getPairedDevice();
        if (paired == null) return;
        console.log('Trying auto-reconnect to', paired.id);
        const d = await bleClient.tryAutoConnect(REQUEST_OPTS, paired.id);
        if (cancelled) return;
        if (d) {
          console.log('Auto-reconnect succeeded', d.id);
          await attachDevice(d);
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
      const d = await bleClient.requestDevice(REQUEST_OPTS);
      await attachDevice(d);
    } catch (e) {
      console.error('Connection failed:', e);
    } finally {
      setIsConnecting(false);
    }
  }, [attachDevice]);

  return [device, doConnect, { isConnecting, isAutoConnecting }];
}
