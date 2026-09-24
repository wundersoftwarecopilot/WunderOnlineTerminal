/**
 * Generic Bluetooth Low Energy transport based on the Web Bluetooth API.
 *
 * - The device is chosen by the user through the browser picker.
 * - Services and characteristics are discovered dynamically at runtime.
 * - Nothing is written to the device unless the user explicitly asks for it
 *   (write, or subscribe which enables notifications/indications).
 * - No device-specific protocol, handshake or UUID is implemented here.
 */
import { Emitter } from '../../core/emitter';
import { toUint8Array } from '../../core/bytes';
import { TransportError, toTransportError } from '../errors';
import {
  checkApiSupport,
  type ConnectionState,
  type SendResult,
  type SupportStatus,
  type Transport,
  type TransportEvents,
} from '../types';
import {
  GENERIC_INFRASTRUCTURE_SERVICES,
  characteristicName,
  serviceName,
} from './knownUuids';
import { isSigUuid, shortUuid } from './uuid';
import {
  getNavigatorBluetooth,
  type BluetoothDeviceLike,
  type BluetoothLike,
  type BluetoothServiceUuid,
  type GattCharacteristicLike,
  type GattServerLike,
  type RequestDeviceOptionsLike,
} from './webBluetooth';

export type BleWriteMode = 'auto' | 'withResponse' | 'withoutResponse';

export const BLE_MAX_CHUNK = 512;

export interface BleProperties {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
  broadcast: boolean;
  authenticatedSignedWrites: boolean;
  reliableWrite: boolean;
  writableAuxiliaries: boolean;
}

export interface BleCharacteristicInfo {
  /** Stable id within the current connection. */
  id: string;
  serviceUuid: string;
  uuid: string;
  name?: string;
  properties: BleProperties;
  subscribed: boolean;
}

export interface BleServiceInfo {
  uuid: string;
  name?: string;
  characteristics: BleCharacteristicInfo[];
}

export interface BleConnectOptions {
  /** Optional device name prefix filter for the picker. */
  namePrefix: string;
  /** Services the page is allowed to access (see knownUuids.ts). */
  optionalServices: BluetoothServiceUuid[];
  /** Subscribe to all notify/indicate characteristics after connecting. */
  autoSubscribe: boolean;
  /** Maximum bytes per GATT write. */
  chunkSize: number;
  writeMode: BleWriteMode;
}

export interface BleEvents extends TransportEvents {
  services: BleServiceInfo[];
  txTarget: string | undefined;
  subscription: { id: string; channel: string; subscribed: boolean };
}

interface CharacteristicEntry {
  info: BleCharacteristicInfo;
  characteristic: GattCharacteristicLike;
  listener?: (event: Event) => void;
  readsInFlight: number;
  /** Values received through events while a read was in flight. */
  held: DataView[];
  heldTimer?: ReturnType<typeof setTimeout>;
}

export interface BluetoothTransportDeps {
  bluetooth?: BluetoothLike | (() => BluetoothLike | undefined);
  isSecureContext?: () => boolean | undefined;
  getOptions: () => BleConnectOptions;
}

function readProperties(c: GattCharacteristicLike): BleProperties {
  const p = c.properties;
  return {
    read: !!p.read,
    write: !!p.write,
    writeWithoutResponse: !!p.writeWithoutResponse,
    notify: !!p.notify,
    indicate: !!p.indicate,
    broadcast: !!p.broadcast,
    authenticatedSignedWrites: !!p.authenticatedSignedWrites,
    reliableWrite: !!p.reliableWrite,
    writableAuxiliaries: !!p.writableAuxiliaries,
  };
}

export function isWritable(p: BleProperties): boolean {
  return p.write || p.writeWithoutResponse;
}

export function isSubscribable(p: BleProperties): boolean {
  return p.notify || p.indicate;
}

/** Chooses the effective write type for a characteristic. */
export function resolveWriteMode(
  p: BleProperties,
  requested: BleWriteMode,
): 'withResponse' | 'withoutResponse' {
  if (requested === 'withoutResponse' && p.writeWithoutResponse) return 'withoutResponse';
  if (requested === 'withResponse' && p.write) return 'withResponse';
  // auto, or requested type not supported by the characteristic
  return p.write ? 'withResponse' : 'withoutResponse';
}

/** Splits data into chunks of at most `size` bytes. */
export function chunkBytes(data: Uint8Array, size: number): Uint8Array<ArrayBuffer>[] {
  const n = Math.max(1, Math.min(BLE_MAX_CHUNK, Math.floor(size) || 1));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < data.length; i += n) chunks.push(data.slice(i, i + n));
  return chunks;
}

/** Short label used in terminal lines for a characteristic. */
export function characteristicLabel(info: Pick<BleCharacteristicInfo, 'uuid' | 'name'>): string {
  const short = shortUuid(info.uuid);
  return info.name ? `${short} ${info.name}` : short;
}

/** Picks a sensible default TX characteristic, or undefined. */
export function pickDefaultTxTarget(services: readonly BleServiceInfo[]): string | undefined {
  const writable = services.flatMap((s) =>
    s.characteristics.filter((c) => isWritable(c.properties)),
  );
  const nonInfra = writable.filter(
    (c) => !GENERIC_INFRASTRUCTURE_SERVICES.includes(c.serviceUuid.toLowerCase()),
  );
  // Prefer custom (non-SIG) services: they usually carry application data.
  const custom = nonInfra.find((c) => !isSigUuid(c.serviceUuid));
  return (custom ?? nonInfra[0])?.id;
}

export class BluetoothTransport implements Transport {
  readonly kind = 'ble' as const;

  private readonly emitter = new Emitter<BleEvents>();
  private _state: ConnectionState = 'disconnected';
  private device: BluetoothDeviceLike | undefined;
  private server: GattServerLike | undefined;
  private services: BleServiceInfo[] = [];
  private readonly entries = new Map<string, CharacteristicEntry>();
  private txTargetId: string | undefined;
  private userDisconnect = false;
  private opChain: Promise<unknown> = Promise.resolve();
  private connectAttempt = 0;

  constructor(private readonly deps: BluetoothTransportDeps) {}

  // ---------------------------------------------------------------- state

  get state(): ConnectionState {
    return this._state;
  }

  get deviceName(): string | undefined {
    const name = this.device?.name;
    return name ? name : undefined;
  }

  get deviceId(): string | undefined {
    return this.device?.id;
  }

  get txTarget(): string | undefined {
    return this.txTargetId;
  }

  getServices(): BleServiceInfo[] {
    return this.services;
  }

  getCharacteristic(id: string): BleCharacteristicInfo | undefined {
    return this.entries.get(id)?.info;
  }

  on<K extends keyof BleEvents>(event: K, listener: (payload: BleEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }

  private get bluetooth(): BluetoothLike | undefined {
    const b = this.deps.bluetooth;
    if (typeof b === 'function') return b();
    return b ?? getNavigatorBluetooth();
  }

  checkSupport(): SupportStatus {
    const secure =
      this.deps.isSecureContext?.() ??
      (typeof window !== 'undefined' ? window.isSecureContext : undefined);
    return checkApiSupport(this.bluetooth, secure);
  }

  /** Not narrowed by TypeScript across awaits (unlike `this._state`). */
  private isConnected(): boolean {
    return this._state === 'connected';
  }

  canSend(): boolean {
    return this._state === 'connected' && !!this.txTargetId && this.entries.has(this.txTargetId);
  }

  private setState(state: ConnectionState, lost = false): void {
    if (this._state === state) return;
    this._state = state;
    this.emitter.emit('state', { state, deviceName: this.deviceName, lost });
  }

  // ----------------------------------------------------------- connection

  async connect(): Promise<void> {
    if (this._state !== 'disconnected') throw new TransportError('busy');
    const support = this.checkSupport();
    if (!support.supported) {
      throw new TransportError(support.reason === 'noApi' ? 'notSupported' : 'insecureContext');
    }
    const bluetooth = this.bluetooth!;
    const options = this.deps.getOptions();
    // Every await below may be overtaken by disconnect() or by the device
    // going away: those bump `connectAttempt` and own the state from then on.
    const attempt = ++this.connectAttempt;
    const current = (): boolean => attempt === this.connectAttempt;
    this.setState('connecting');

    try {
      if (bluetooth.getAvailability) {
        let available = true;
        try {
          available = await bluetooth.getAvailability();
        } catch {
          available = true; // unknown: let requestDevice() decide
        }
        if (!available) throw new TransportError('adapterUnavailable');
      }

      const request: RequestDeviceOptionsLike = { optionalServices: options.optionalServices };
      const prefix = options.namePrefix.trim();
      if (prefix) request.filters = [{ namePrefix: prefix }];
      else request.acceptAllDevices = true;

      let device: BluetoothDeviceLike;
      try {
        device = await bluetooth.requestDevice(request);
      } catch (err) {
        throw toTransportError(err, 'connectionFailed', 'request');
      }
      if (!current()) return;
      this.device = device;
      device.addEventListener('gattserverdisconnected', this.onGattDisconnected);

      const gatt = device.gatt;
      if (!gatt) throw new TransportError('operationNotSupported');
      let server: GattServerLike;
      try {
        server = await gatt.connect();
      } catch (err) {
        throw toTransportError(err, 'connectionFailed');
      }
      if (!current()) return this.abandon(device);

      const discovered = await this.discover(server);
      if (!current()) return this.abandon(device);

      this.server = server;
      this.services = discovered.services;
      this.entries.clear();
      discovered.entries.forEach((entry, id) => this.entries.set(id, entry));
      this.txTargetId = pickDefaultTxTarget(discovered.services);
      this.setState('connected');
      this.emitter.emit('services', this.services);
      this.emitter.emit('txTarget', this.txTargetId);

      if (options.autoSubscribe) {
        for (const entry of discovered.entries.values()) {
          if (!current() || !this.isConnected()) break;
          if (!isSubscribable(entry.info.properties)) continue;
          try {
            await this.subscribe(entry.info.id);
          } catch (err) {
            if (current()) {
              this.emitter.emit('error', { error: toTransportError(err, 'subscribeFailed') });
            }
          }
        }
      }
    } catch (err) {
      // Superseded attempts end silently: whoever overtook them (a user
      // disconnect or a lost connection) has already updated the state.
      if (!current()) return;
      this.teardown();
      this.setState('disconnected');
      throw toTransportError(err, 'connectionFailed');
    }
  }

  /** Drops a connection that was established by a superseded attempt. */
  private abandon(device: BluetoothDeviceLike): void {
    if (this._state === 'disconnected' && device.gatt?.connected) {
      try {
        device.gatt.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') return;
    this.connectAttempt++;
    this.userDisconnect = true;
    this.setState('disconnecting');
    try {
      if (this.server?.connected) {
        for (const entry of this.entries.values()) {
          if (entry.info.subscribed) {
            try {
              await entry.characteristic.stopNotifications();
            } catch {
              /* best effort */
            }
          }
        }
      }
      const gatt = this.device?.gatt;
      this.teardown();
      try {
        gatt?.disconnect();
      } catch {
        /* already disconnected */
      }
    } finally {
      this.userDisconnect = false;
      this.setState('disconnected');
    }
  }

  private readonly onGattDisconnected = (): void => {
    if (this.userDisconnect) return;
    const wasActive = this._state === 'connected' || this._state === 'connecting';
    this.connectAttempt++;
    this.teardown();
    if (wasActive) this.setState('disconnected', true);
  };

  /** Removes every listener and forgets the GATT tree. */
  private teardown(): void {
    for (const entry of this.entries.values()) {
      if (entry.listener) {
        entry.characteristic.removeEventListener('characteristicvaluechanged', entry.listener);
      }
      if (entry.heldTimer) clearTimeout(entry.heldTimer);
    }
    this.entries.clear();
    this.device?.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    this.server = undefined;
    this.services = [];
    const hadTarget = this.txTargetId !== undefined;
    this.txTargetId = undefined;
    this.emitter.emit('services', []);
    if (hadTarget) this.emitter.emit('txTarget', undefined);
  }

  // ------------------------------------------------------------ discovery

  /** Reads the GATT tree without touching the transport state. */
  private async discover(
    server: GattServerLike,
  ): Promise<{ services: BleServiceInfo[]; entries: Map<string, CharacteristicEntry> }> {
    let gattServices: Awaited<ReturnType<GattServerLike['getPrimaryServices']>> = [];
    try {
      gattServices = await server.getPrimaryServices();
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      // NotFoundError: the device exposes no accessible service.
      if (name !== 'NotFoundError') throw toTransportError(err, 'connectionFailed');
    }

    const services: BleServiceInfo[] = [];
    const entries = new Map<string, CharacteristicEntry>();
    let serviceIndex = 0;
    for (const svc of gattServices) {
      const serviceUuid = svc.uuid.toLowerCase();
      const info: BleServiceInfo = {
        uuid: serviceUuid,
        name: serviceName(serviceUuid),
        characteristics: [],
      };
      let chars: GattCharacteristicLike[] = [];
      try {
        chars = await svc.getCharacteristics();
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name !== 'NotFoundError' && name !== 'SecurityError') {
          throw toTransportError(err, 'connectionFailed');
        }
      }
      let charIndex = 0;
      for (const c of chars) {
        const uuid = c.uuid.toLowerCase();
        const ci: BleCharacteristicInfo = {
          id: `${serviceIndex}:${charIndex}`,
          serviceUuid,
          uuid,
          name: characteristicName(uuid),
          properties: readProperties(c),
          subscribed: false,
        };
        info.characteristics.push(ci);
        entries.set(ci.id, { info: ci, characteristic: c, readsInFlight: 0, held: [] });
        charIndex++;
      }
      services.push(info);
      serviceIndex++;
    }
    return { services, entries };
  }

  /** Total number of discovered characteristics. */
  get characteristicCount(): number {
    return this.entries.size;
  }

  // ----------------------------------------------------------- operations

  /** GATT operations are serialized: browsers reject concurrent ones. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(op, op);
    this.opChain = run.catch(() => undefined);
    return run;
  }

  private requireEntry(id: string): CharacteristicEntry {
    if (this._state !== 'connected') throw new TransportError('notConnected');
    const entry = this.entries.get(id);
    if (!entry) throw new TransportError('notConnected');
    return entry;
  }

  /** Reads a characteristic; the value is emitted as a `data` event. */
  async read(id: string): Promise<Uint8Array> {
    const entry = this.requireEntry(id);
    if (!entry.info.properties.read) throw new TransportError('operationNotSupported');
    return this.enqueue(async () => {
      entry.readsInFlight++;
      let value: DataView;
      try {
        value = await entry.characteristic.readValue();
      } catch (err) {
        throw toTransportError(err, 'readFailed');
      } finally {
        entry.readsInFlight--;
      }
      // Per spec, readValue() also fires `characteristicvaluechanged` with
      // the very same DataView: drop that echo so the value is logged once.
      const echo = entry.held.indexOf(value);
      if (echo !== -1) entry.held.splice(echo, 1);
      const bytes = toUint8Array(value);
      this.emitter.emit('data', {
        bytes,
        channel: characteristicLabel(entry.info),
        origin: 'read',
      });
      return bytes;
    });
  }

  async subscribe(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    if (!isSubscribable(entry.info.properties)) throw new TransportError('operationNotSupported');
    if (entry.info.subscribed) return;
    await this.enqueue(async () => {
      const listener = (event: Event): void => this.onValueChanged(entry, event);
      entry.characteristic.addEventListener('characteristicvaluechanged', listener);
      entry.listener = listener;
      // Accept values right away: some devices notify immediately.
      entry.info.subscribed = true;
      try {
        await entry.characteristic.startNotifications();
      } catch (err) {
        entry.characteristic.removeEventListener('characteristicvaluechanged', listener);
        entry.listener = undefined;
        entry.info.subscribed = false;
        throw toTransportError(err, 'subscribeFailed');
      }
    });
    this.emitter.emit('services', this.services);
    this.emitter.emit('subscription', {
      id,
      channel: characteristicLabel(entry.info),
      subscribed: true,
    });
  }

  async unsubscribe(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    if (!entry.info.subscribed) return;
    try {
      await this.enqueue(async () => {
        try {
          await entry.characteristic.stopNotifications();
        } catch (err) {
          if (this.server?.connected) throw toTransportError(err, 'subscribeFailed');
        }
      });
    } finally {
      // Stop listening locally in any case: the user asked to stop.
      if (entry.listener) {
        entry.characteristic.removeEventListener('characteristicvaluechanged', entry.listener);
        entry.listener = undefined;
      }
      entry.info.subscribed = false;
      this.emitter.emit('services', this.services);
      this.emitter.emit('subscription', {
        id,
        channel: characteristicLabel(entry.info),
        subscribed: false,
      });
    }
  }

  private onValueChanged(entry: CharacteristicEntry, event: Event): void {
    const target = event.target as GattCharacteristicLike | null;
    const value = target?.value;
    if (!value) return;
    if (entry.readsInFlight > 0) {
      // Might be the echo of a pending read(): decide on the next task.
      entry.held.push(value);
      if (!entry.heldTimer) {
        entry.heldTimer = setTimeout(() => {
          entry.heldTimer = undefined;
          const held = entry.held.splice(0);
          held.forEach((v) => this.emitNotification(entry, v));
        }, 0);
      }
      return;
    }
    this.emitNotification(entry, value);
  }

  private emitNotification(entry: CharacteristicEntry, value: DataView): void {
    if (!entry.info.subscribed) return;
    this.emitter.emit('data', {
      bytes: toUint8Array(value),
      channel: characteristicLabel(entry.info),
      origin: entry.info.properties.notify ? 'notification' : 'indication',
    });
  }

  /** Selects the characteristic used by `send()`. */
  setTxTarget(id: string | undefined): void {
    if (id !== undefined) {
      const entry = this.entries.get(id);
      if (!entry || !isWritable(entry.info.properties)) {
        throw new TransportError('operationNotSupported');
      }
    }
    this.txTargetId = id;
    this.emitter.emit('txTarget', id);
  }

  async send(data: Uint8Array): Promise<SendResult> {
    if (this._state !== 'connected') throw new TransportError('notConnected');
    const id = this.txTargetId;
    const entry = id !== undefined ? this.entries.get(id) : undefined;
    if (!entry) throw new TransportError('noWritableChannel');
    const options = this.deps.getOptions();
    const mode = resolveWriteMode(entry.info.properties, options.writeMode);
    const c = entry.characteristic;
    const write =
      mode === 'withResponse'
        ? (c.writeValueWithResponse ?? c.writeValue)
        : (c.writeValueWithoutResponse ?? c.writeValue);
    if (!write) throw new TransportError('operationNotSupported');

    await this.enqueue(async () => {
      for (const chunk of chunkBytes(data, options.chunkSize)) {
        try {
          await write.call(c, chunk);
        } catch (err) {
          throw toTransportError(err, 'writeFailed');
        }
      }
    });
    return { channel: characteristicLabel(entry.info) };
  }
}
