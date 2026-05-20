import type {
  BleCharacteristic,
  BleClient,
  BleDevice,
  BleService,
  RequestDeviceOptions,
} from './types';

class WebBleCharacteristic implements BleCharacteristic {
  constructor(private characteristic: BluetoothRemoteGATTCharacteristic) {}

  async read(): Promise<Uint8Array> {
    const value = await this.characteristic.readValue();
    return new Uint8Array(value.buffer);
  }

  async write(data: Uint8Array): Promise<void> {
    await this.characteristic.writeValue(data as BufferSource);
  }

  async subscribe(callback: (data: Uint8Array) => void): Promise<() => void> {
    await this.characteristic.startNotifications();
    const handler = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (target.value) {
        callback(new Uint8Array(target.value.buffer));
      }
    };
    this.characteristic.addEventListener('characteristicvaluechanged', handler);
    return () => {
      this.characteristic.removeEventListener('characteristicvaluechanged', handler);
      this.characteristic.stopNotifications().catch(() => {
        /* device may already be gone */
      });
    };
  }
}

class WebBleService implements BleService {
  constructor(private service: BluetoothRemoteGATTService) {}

  async getCharacteristic(uuid: string): Promise<BleCharacteristic> {
    const char = await this.service.getCharacteristic(uuid);
    return new WebBleCharacteristic(char);
  }
}

class WebBleDevice implements BleDevice {
  constructor(
    private device: BluetoothDevice,
    private server: BluetoothRemoteGATTServer,
  ) {}

  get id(): string {
    return this.device.id;
  }

  get name(): string | null {
    return this.device.name ?? null;
  }

  async getService(uuid: string): Promise<BleService> {
    const service = await this.server.getPrimaryService(uuid);
    return new WebBleService(service);
  }

  onDisconnect(callback: () => void): () => void {
    const handler = () => callback();
    this.device.addEventListener('gattserverdisconnected', handler);
    return () => {
      this.device.removeEventListener('gattserverdisconnected', handler);
    };
  }
}

class WebBleClient implements BleClient {
  async requestDevice(opts: RequestDeviceOptions): Promise<BleDevice> {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: opts.name }],
      optionalServices: opts.services,
    });
    if (!device.gatt) {
      throw new Error('GATT server unavailable on the selected device');
    }
    const server = await device.gatt.connect();
    return new WebBleDevice(device, server);
  }

  async tryAutoConnect(_opts: RequestDeviceOptions, deviceId: string): Promise<BleDevice | null> {
    // navigator.bluetooth.getDevices() returns devices the origin has
    // already been granted permission for. Only available in Chrome
    // 117+; older browsers return undefined.
    const getDevices = (
      navigator.bluetooth as unknown as {
        getDevices?: () => Promise<BluetoothDevice[]>;
      }
    ).getDevices;
    if (!getDevices) return null;
    try {
      const devices = await getDevices.call(navigator.bluetooth);
      const target = devices.find((d) => d.id === deviceId);
      if (!target?.gatt) return null;
      const server = await target.gatt.connect();
      return new WebBleDevice(target, server);
    } catch {
      return null;
    }
  }
}

export const bleClient: BleClient = new WebBleClient();
export type { BleCharacteristic, BleDevice, BleService } from './types';
