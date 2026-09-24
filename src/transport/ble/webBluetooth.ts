/**
 * Minimal structural types for the subset of the Web Bluetooth API used by
 * the terminal. They are declared here (instead of relying on
 * `@types/web-bluetooth`) so that tests can provide lightweight mocks.
 */

export type BluetoothServiceUuid = number | string;

export interface BluetoothLEScanFilterLike {
  name?: string;
  namePrefix?: string;
  services?: BluetoothServiceUuid[];
}

export interface RequestDeviceOptionsLike {
  filters?: BluetoothLEScanFilterLike[];
  acceptAllDevices?: boolean;
  optionalServices?: BluetoothServiceUuid[];
}

export interface CharacteristicPropertiesLike {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly authenticatedSignedWrites: boolean;
  readonly reliableWrite: boolean;
  readonly writableAuxiliaries: boolean;
}

export interface GattCharacteristicLike extends EventTarget {
  readonly uuid: string;
  readonly properties: CharacteristicPropertiesLike;
  readonly value?: DataView | null;
  readValue(): Promise<DataView>;
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  startNotifications(): Promise<GattCharacteristicLike>;
  stopNotifications(): Promise<GattCharacteristicLike>;
}

export interface GattServiceLike {
  readonly uuid: string;
  getCharacteristics(): Promise<GattCharacteristicLike[]>;
}

export interface GattServerLike {
  readonly connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryServices(): Promise<GattServiceLike[]>;
}

export interface BluetoothDeviceLike extends EventTarget {
  readonly id: string;
  readonly name?: string | null;
  readonly gatt?: GattServerLike | null;
}

export interface BluetoothLike {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: RequestDeviceOptionsLike): Promise<BluetoothDeviceLike>;
}

/** Returns `navigator.bluetooth` when available. */
export function getNavigatorBluetooth(): BluetoothLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const bt = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
  return bt ?? undefined;
}
