// Platform-agnostic BLE interface. ble.web.ts and ble.native.ts both
// implement it; Metro resolves the right one via .web.ts / .native.ts
// suffix, so consumers just `import { requestDevice } from './ble'`.

export interface BleCharacteristic {
  read(): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  /** Subscribe to NOTIFY/INDICATE updates. Returns an unsubscribe function. */
  subscribe(callback: (data: Uint8Array) => void): Promise<() => void>;
}

export interface BleService {
  getCharacteristic(uuid: string): Promise<BleCharacteristic>;
}

export interface BleDevice {
  id: string;
  name: string | null;
  getService(uuid: string): Promise<BleService>;
  /** Register a callback for disconnect events. Returns an unsubscribe function. */
  onDisconnect(callback: () => void): () => void;
}

export interface RequestDeviceOptions {
  /** Filter by exact device name (e.g. "envsense"). */
  name: string;
  /** Service UUIDs the app intends to access (lower-case, with dashes). */
  services: string[];
}

/** Implemented by ble.web.ts and ble.native.ts. */
export interface BleClient {
  requestDevice(opts: RequestDeviceOptions): Promise<BleDevice>;
  /**
   * Try to connect to a previously paired device without prompting the
   * user. Returns null if the device isn't reachable or the platform
   * can't enumerate prior permissions.
   */
  tryAutoConnect(opts: RequestDeviceOptions, deviceId: string): Promise<BleDevice | null>;
}
