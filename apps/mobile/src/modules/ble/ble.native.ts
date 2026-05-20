import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';
import { fromByteArray, toByteArray } from 'react-native-quick-base64';
import type {
  BleCharacteristic,
  BleClient,
  BleDevice,
  BleService,
  RequestDeviceOptions,
} from './types';

const MTU = 517;
const SCAN_TIMEOUT_MS = 15000;

let _manager: BleManager | null = null;
function manager(): BleManager {
  if (!_manager) _manager = new BleManager();
  return _manager;
}

async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const apiLevel = Platform.Version as number;
  const required =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const results = await PermissionsAndroid.requestMultiple(required);
  for (const perm of required) {
    if (results[perm] !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error(`BLE permission not granted: ${perm}`);
    }
  }
}

async function waitForPoweredOn(timeoutMs: number): Promise<void> {
  const m = manager();
  const state = await m.state();
  if (state === 'PoweredOn') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth not powered on'));
    }, timeoutMs);
    const sub: Subscription = m.onStateChange((s) => {
      if (s === 'PoweredOn') {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, false);
  });
}

function scanForDevice(name: string, timeoutMs: number): Promise<Device> {
  return new Promise((resolve, reject) => {
    const m = manager();
    const timer = setTimeout(() => {
      m.stopDeviceScan();
      reject(new Error(`Scan timed out: ${name} not found`));
    }, timeoutMs);
    m.startDeviceScan(null, null, (error, device) => {
      if (error) {
        clearTimeout(timer);
        m.stopDeviceScan();
        reject(error);
        return;
      }
      if (device && device.name === name) {
        clearTimeout(timer);
        m.stopDeviceScan();
        resolve(device);
      }
    });
  });
}

class NativeBleCharacteristic implements BleCharacteristic {
  constructor(
    private device: Device,
    private serviceUuid: string,
    private charUuid: string,
  ) {}

  async read(): Promise<Uint8Array> {
    const c = await this.device.readCharacteristicForService(this.serviceUuid, this.charUuid);
    return c.value ? toByteArray(c.value) : new Uint8Array(0);
  }

  async write(data: Uint8Array): Promise<void> {
    const b64 = fromByteArray(data);
    await this.device.writeCharacteristicWithResponseForService(
      this.serviceUuid,
      this.charUuid,
      b64,
    );
  }

  async subscribe(callback: (data: Uint8Array) => void): Promise<() => void> {
    const sub = this.device.monitorCharacteristicForService(
      this.serviceUuid,
      this.charUuid,
      (error, characteristic) => {
        if (error) {
          // Silenced once unsubscribed; log others for debugging.
          if (!String(error.message).match(/cancell?ed/i)) {
            console.warn('BLE monitor error', error);
          }
          return;
        }
        if (characteristic?.value) {
          callback(toByteArray(characteristic.value));
        }
      },
    );
    return () => sub.remove();
  }
}

class NativeBleService implements BleService {
  constructor(
    private device: Device,
    private serviceUuid: string,
  ) {}

  async getCharacteristic(uuid: string): Promise<BleCharacteristic> {
    return new NativeBleCharacteristic(this.device, this.serviceUuid, uuid);
  }
}

class NativeBleDevice implements BleDevice {
  constructor(private device: Device) {}

  get id(): string {
    return this.device.id;
  }

  get name(): string | null {
    return this.device.name;
  }

  async getService(uuid: string): Promise<BleService> {
    // ble-plx requires service+characteristic discovery before reads/writes;
    // we did this once in requestDevice(). Just hand back a thin wrapper.
    return new NativeBleService(this.device, uuid);
  }

  onDisconnect(callback: () => void): () => void {
    const sub = this.device.onDisconnected(() => callback());
    return () => sub.remove();
  }
}

async function finishConnect(device: Device): Promise<NativeBleDevice> {
  try {
    await device.requestMTU(MTU);
  } catch (err) {
    // iOS negotiates MTU automatically and rejects manual requests;
    // Android may also fail on some stacks. Log and continue.
    console.warn('requestMTU failed (continuing)', err);
  }
  await device.discoverAllServicesAndCharacteristics();
  return new NativeBleDevice(device);
}

class NativeBleClient implements BleClient {
  async requestDevice(opts: RequestDeviceOptions): Promise<BleDevice> {
    await requestAndroidPermissions();
    await waitForPoweredOn(5000);
    const found = await scanForDevice(opts.name, SCAN_TIMEOUT_MS);
    const connected = await found.connect();
    return finishConnect(connected);
  }

  async tryAutoConnect(_opts: RequestDeviceOptions, deviceId: string): Promise<BleDevice | null> {
    try {
      await requestAndroidPermissions();
      await waitForPoweredOn(5000);
      // ble-plx's connectToDevice goes straight to GATT connect without
      // scanning, so this is a fast no-op when the device isn't nearby
      // and a few-hundred-ms reconnect when it is.
      const connected = await manager().connectToDevice(deviceId, { timeout: 5000 });
      return await finishConnect(connected);
    } catch {
      return null;
    }
  }
}

export const bleClient: BleClient = new NativeBleClient();
export type { BleCharacteristic, BleDevice, BleService } from './types';
