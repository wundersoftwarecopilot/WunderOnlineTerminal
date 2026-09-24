/**
 * In-memory Web Bluetooth mock: lets the terminal logic be tested without
 * any real device. It models only generic GATT behaviour.
 */
import type {
  BluetoothDeviceLike,
  BluetoothLike,
  CharacteristicPropertiesLike,
  GattCharacteristicLike,
  GattServerLike,
  GattServiceLike,
  RequestDeviceOptionsLike,
} from '../../src/transport/ble/webBluetooth';

export function domError(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

export type PropName = keyof CharacteristicPropertiesLike;

export function props(...names: PropName[]): CharacteristicPropertiesLike {
  const all: CharacteristicPropertiesLike = {
    broadcast: false,
    read: false,
    writeWithoutResponse: false,
    write: false,
    notify: false,
    indicate: false,
    authenticatedSignedWrites: false,
    reliableWrite: false,
    writableAuxiliaries: false,
  };
  const out = { ...all } as Record<PropName, boolean>;
  for (const n of names) out[n] = true;
  return out;
}

export interface WriteRecord {
  bytes: number[];
  withResponse: boolean;
}

export class MockCharacteristic extends EventTarget implements GattCharacteristicLike {
  value: DataView | null = null;
  notifying = false;
  readonly writes: WriteRecord[] = [];
  readValueImpl: () => Uint8Array = () => new Uint8Array(0);
  failNext: Partial<Record<'read' | 'write' | 'start' | 'stop', DOMException>> = {};
  service?: MockService;

  constructor(
    readonly uuid: string,
    readonly properties: CharacteristicPropertiesLike,
  ) {
    super();
  }

  private takeFailure(op: 'read' | 'write' | 'start' | 'stop'): void {
    const err = this.failNext[op];
    if (err) {
      delete this.failNext[op];
      throw err;
    }
  }

  private checkConnected(): void {
    if (!this.service?.device?.gatt.connected) throw domError('NetworkError', 'GATT Server is disconnected.');
  }

  async readValue(): Promise<DataView> {
    this.checkConnected();
    this.takeFailure('read');
    if (!this.properties.read) throw domError('NotSupportedError');
    const bytes = this.readValueImpl();
    const view = new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    // Web Bluetooth spec: readValue() fires characteristicvaluechanged
    // with the same DataView before resolving.
    this.value = view;
    this.dispatchEvent(new Event('characteristicvaluechanged'));
    return view;
  }

  private async doWrite(value: BufferSource, withResponse: boolean): Promise<void> {
    this.checkConnected();
    this.takeFailure('write');
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.writes.push({ bytes: Array.from(bytes), withResponse });
  }

  writeValueWithResponse(value: BufferSource): Promise<void> {
    if (!this.properties.write) return Promise.reject(domError('NotSupportedError'));
    return this.doWrite(value, true);
  }

  writeValueWithoutResponse(value: BufferSource): Promise<void> {
    if (!this.properties.writeWithoutResponse) return Promise.reject(domError('NotSupportedError'));
    return this.doWrite(value, false);
  }

  async startNotifications(): Promise<GattCharacteristicLike> {
    this.checkConnected();
    this.takeFailure('start');
    if (!this.properties.notify && !this.properties.indicate) throw domError('NotSupportedError');
    this.notifying = true;
    return this;
  }

  async stopNotifications(): Promise<GattCharacteristicLike> {
    this.takeFailure('stop');
    this.notifying = false;
    return this;
  }

  /** Simulates a notification/indication sent by the peripheral. */
  emit(bytes: number[] | Uint8Array): void {
    if (!this.notifying) return;
    const arr = Uint8Array.from(bytes);
    this.value = new DataView(arr.buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

export class MockService implements GattServiceLike {
  device?: MockDevice;
  failCharacteristics?: DOMException;

  constructor(
    readonly uuid: string,
    readonly characteristics: MockCharacteristic[],
  ) {
    characteristics.forEach((c) => (c.service = this));
  }

  async getCharacteristics(): Promise<GattCharacteristicLike[]> {
    if (this.failCharacteristics) throw this.failCharacteristics;
    if (this.characteristics.length === 0) throw domError('NotFoundError', 'No Characteristics found');
    return [...this.characteristics];
  }
}

export class MockGattServer implements GattServerLike {
  connected = false;
  connectError?: DOMException;
  connectCalls = 0;
  /** When set, connect() / getPrimaryServices() wait for these promises. */
  connectGate?: Promise<void>;
  discoveryGate?: Promise<void>;

  constructor(
    readonly device: MockDevice,
    readonly services: MockService[],
  ) {}

  async connect(): Promise<GattServerLike> {
    this.connectCalls++;
    if (this.connectGate) await this.connectGate;
    if (this.connectError) throw this.connectError;
    this.connected = true;
    return this;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.services.forEach((s) => s.characteristics.forEach((c) => (c.notifying = false)));
    this.device.dispatchEvent(new Event('gattserverdisconnected'));
  }

  async getPrimaryServices(): Promise<GattServiceLike[]> {
    if (this.discoveryGate) await this.discoveryGate;
    if (!this.connected) throw domError('NetworkError');
    if (this.services.length === 0) throw domError('NotFoundError', 'No Services found in device.');
    return [...this.services];
  }
}

export class MockDevice extends EventTarget implements BluetoothDeviceLike {
  readonly gatt: MockGattServer;

  constructor(
    readonly id: string,
    readonly name: string | null,
    services: MockService[],
  ) {
    super();
    services.forEach((s) => (s.device = this));
    this.gatt = new MockGattServer(this, services);
  }

  /** Simulates the peripheral going out of range / powering off. */
  loseConnection(): void {
    this.gatt.disconnect();
  }

  characteristic(uuid: string): MockCharacteristic {
    for (const s of this.gatt.services) {
      const c = s.characteristics.find((x) => x.uuid === uuid);
      if (c) return c;
    }
    throw new Error(`no characteristic ${uuid}`);
  }
}

export class MockBluetooth implements BluetoothLike {
  available = true;
  /** Device returned by the picker; `null` simulates "Cancel". */
  nextDevice: MockDevice | null;
  requestError?: DOMException;
  readonly requests: RequestDeviceOptionsLike[] = [];

  constructor(device: MockDevice | null) {
    this.nextDevice = device;
  }

  async getAvailability(): Promise<boolean> {
    return this.available;
  }

  async requestDevice(options: RequestDeviceOptionsLike): Promise<BluetoothDeviceLike> {
    this.requests.push(options);
    if (this.requestError) throw this.requestError;
    if (!this.nextDevice) throw domError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    return this.nextDevice;
  }
}

/**
 * A generic test peripheral:
 * - Battery service (SIG 0x180F) with a readable + notifying level;
 * - a custom 128-bit "data" service with one writable and one notifying
 *   characteristic (random UUIDs generated for tests only).
 */
export const TEST_UUIDS = {
  battery: '0000180f-0000-1000-8000-00805f9b34fb',
  batteryLevel: '00002a19-0000-1000-8000-00805f9b34fb',
  customService: '12345678-0000-4000-8000-00000000a000',
  customWrite: '12345678-0000-4000-8000-00000000a001',
  customNotify: '12345678-0000-4000-8000-00000000a002',
} as const;

export function createTestPeripheral(name: string | null = 'Test Peripheral'): MockDevice {
  const level = new MockCharacteristic(TEST_UUIDS.batteryLevel, props('read', 'notify'));
  level.readValueImpl = () => Uint8Array.of(87);
  const write = new MockCharacteristic(TEST_UUIDS.customWrite, props('write', 'writeWithoutResponse'));
  const notify = new MockCharacteristic(TEST_UUIDS.customNotify, props('notify'));
  return new MockDevice('device-1', name, [
    new MockService(TEST_UUIDS.battery, [level]),
    new MockService(TEST_UUIDS.customService, [write, notify]),
  ]);
}
