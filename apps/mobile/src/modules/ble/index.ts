import { Platform } from 'react-native';
import type { BleClient } from './types';

// Lazy-load the platform implementation so the web bundle never pulls in
// react-native-ble-plx's native bridge code, and the native bundle never
// pulls in Web Bluetooth references.
let _clientPromise: Promise<BleClient> | null = null;
function getClient(): Promise<BleClient> {
  if (_clientPromise) return _clientPromise;
  _clientPromise = (Platform.OS === 'web' ? import('./ble.web') : import('./ble.native')).then(
    (m) => m.bleClient,
  );
  return _clientPromise;
}

export const bleClient: BleClient = {
  async requestDevice(opts) {
    return (await getClient()).requestDevice(opts);
  },
  async tryAutoConnect(opts, deviceId) {
    return (await getClient()).tryAutoConnect(opts, deviceId);
  },
};

export type { BleCharacteristic, BleDevice, BleService, RequestDeviceOptions } from './types';
