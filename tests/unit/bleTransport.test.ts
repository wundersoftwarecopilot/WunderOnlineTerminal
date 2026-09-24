import { describe, expect, it } from 'vitest';
import {
  BluetoothTransport,
  chunkBytes,
  pickDefaultTxTarget,
  resolveWriteMode,
  type BleConnectOptions,
  type BleServiceInfo,
} from '../../src/transport/ble/BluetoothTransport';
import { TransportError } from '../../src/transport/errors';
import type { DataEvent, StateEvent } from '../../src/transport/types';
import {
  MockBluetooth,
  MockCharacteristic,
  MockDevice,
  MockService,
  TEST_UUIDS,
  createTestPeripheral,
  domError,
  props,
} from '../mocks/mockBluetooth';
import { deferred, settle } from '../mocks/mockSerial';

function setup(
  device: MockDevice | null = createTestPeripheral(),
  options: Partial<BleConnectOptions> = {},
) {
  const bluetooth = new MockBluetooth(device);
  const opts: BleConnectOptions = {
    namePrefix: '',
    optionalServices: [0x180f, TEST_UUIDS.customService],
    autoSubscribe: false,
    chunkSize: 20,
    writeMode: 'auto',
    ...options,
  };
  const transport = new BluetoothTransport({
    bluetooth,
    isSecureContext: () => true,
    getOptions: () => opts,
  });
  const data: DataEvent[] = [];
  const states: StateEvent[] = [];
  const errors: TransportError[] = [];
  transport.on('data', (e) => data.push(e));
  transport.on('state', (e) => states.push(e));
  transport.on('error', (e) => errors.push(e.error));
  return { bluetooth, transport, device, data, states, errors, opts };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(TransportError);
  await p.catch((e: TransportError) => expect(e.code).toBe(code));
}

const idOf = (t: BluetoothTransport, uuid: string): string => {
  for (const s of t.getServices()) {
    const c = s.characteristics.find((x) => x.uuid === uuid);
    if (c) return c.id;
  }
  throw new Error('not found');
};

describe('BluetoothTransport: support', () => {
  it('reports missing API and insecure context', () => {
    const noApi = new BluetoothTransport({ bluetooth: () => undefined, getOptions: () => ({}) as BleConnectOptions });
    expect(noApi.checkSupport()).toEqual({ supported: false, reason: 'noApi' });
    const insecure = new BluetoothTransport({
      bluetooth: new MockBluetooth(null),
      isSecureContext: () => false,
      getOptions: () => ({}) as BleConnectOptions,
    });
    expect(insecure.checkSupport()).toEqual({ supported: false, reason: 'insecureContext' });
  });

  it('connect() fails cleanly when unsupported', async () => {
    const t = new BluetoothTransport({ bluetooth: () => undefined, getOptions: () => ({}) as BleConnectOptions });
    await expectCode(t.connect(), 'notSupported');
    expect(t.state).toBe('disconnected');
  });
});

describe('BluetoothTransport: connection and dynamic discovery', () => {
  it('requests any device with the configured optional services', async () => {
    const { transport, bluetooth } = setup();
    await transport.connect();
    expect(bluetooth.requests[0]).toEqual({
      acceptAllDevices: true,
      optionalServices: [0x180f, TEST_UUIDS.customService],
    });
  });

  it('uses a name prefix filter when configured', async () => {
    const { transport, bluetooth } = setup(undefined, { namePrefix: ' Sens ' });
    await transport.connect();
    expect(bluetooth.requests[0]).toEqual({
      filters: [{ namePrefix: 'Sens' }],
      optionalServices: [0x180f, TEST_UUIDS.customService],
    });
  });

  it('discovers services, characteristics and their properties', async () => {
    const { transport, states } = setup();
    await transport.connect();
    expect(transport.state).toBe('connected');
    expect(transport.deviceName).toBe('Test Peripheral');
    expect(states.map((s) => s.state)).toEqual(['connecting', 'connected']);

    const services = transport.getServices();
    expect(services.map((s) => [s.uuid, s.name])).toEqual([
      [TEST_UUIDS.battery, 'Battery'],
      [TEST_UUIDS.customService, undefined],
    ]);
    const level = services[0]!.characteristics[0]!;
    expect(level.name).toBe('Battery Level');
    expect(level.properties).toMatchObject({ read: true, notify: true, write: false, indicate: false });
    const write = services[1]!.characteristics[0]!;
    expect(write.properties).toMatchObject({ write: true, writeWithoutResponse: true, read: false });
    expect(transport.characteristicCount).toBe(3);
  });

  it('auto-selects a writable characteristic of a custom service', async () => {
    const { transport } = setup();
    await transport.connect();
    expect(transport.txTarget).toBe(idOf(transport, TEST_UUIDS.customWrite));
    expect(transport.canSend()).toBe(true);
  });

  it('handles devices without accessible services', async () => {
    const { transport } = setup(new MockDevice('x', null, []));
    await transport.connect();
    expect(transport.getServices()).toEqual([]);
    expect(transport.deviceName).toBeUndefined();
    expect(transport.canSend()).toBe(false);
    await expectCode(transport.send(Uint8Array.of(1)), 'noWritableChannel');
  });

  it('maps a cancelled chooser to "cancelled"', async () => {
    const { transport } = setup(null);
    await expectCode(transport.connect(), 'cancelled');
    expect(transport.state).toBe('disconnected');
  });

  it('maps permission errors', async () => {
    const { transport, bluetooth } = setup();
    bluetooth.requestError = domError('SecurityError');
    await expectCode(transport.connect(), 'permissionDenied');
    bluetooth.requestError = domError('NotAllowedError');
    await expectCode(transport.connect(), 'permissionDenied');
  });

  it('reports an unavailable adapter', async () => {
    const { transport, bluetooth } = setup();
    bluetooth.available = false;
    await expectCode(transport.connect(), 'adapterUnavailable');
  });

  it('reports GATT connection failures', async () => {
    const { transport, device } = setup();
    device!.gatt.connectError = domError('NetworkError', 'Connection failed for unknown reason.');
    await expectCode(transport.connect(), 'connectionFailed');
    expect(transport.state).toBe('disconnected');
  });

  it('rejects a second connect while connected', async () => {
    const { transport } = setup();
    await transport.connect();
    await expectCode(transport.connect(), 'busy');
  });
});

describe('BluetoothTransport: read / notify / write', () => {
  it('reads a characteristic and emits the value once', async () => {
    const { transport, data } = setup();
    await transport.connect();
    const id = idOf(transport, TEST_UUIDS.batteryLevel);
    await transport.subscribe(id); // a listener is attached: the read echo must be ignored
    const value = await transport.read(id);
    await settle();
    expect(Array.from(value)).toEqual([87]);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ origin: 'read', channel: '0x2A19 Battery Level' });
    expect(Array.from(data[0]!.bytes)).toEqual([87]);
  });

  it('refuses to read non-readable characteristics', async () => {
    const { transport } = setup();
    await transport.connect();
    await expectCode(transport.read(idOf(transport, TEST_UUIDS.customNotify)), 'operationNotSupported');
  });

  it('maps read failures', async () => {
    const { transport, device } = setup();
    await transport.connect();
    device!.characteristic(TEST_UUIDS.batteryLevel).failNext.read = domError('SecurityError', 'blocklisted');
    await expectCode(transport.read(idOf(transport, TEST_UUIDS.batteryLevel)), 'permissionDenied');
  });

  it('subscribes to notifications and emits received values', async () => {
    const { transport, device, data } = setup();
    await transport.connect();
    const id = idOf(transport, TEST_UUIDS.customNotify);
    const events: boolean[] = [];
    transport.on('subscription', (e) => events.push(e.subscribed));
    await transport.subscribe(id);
    expect(transport.getCharacteristic(id)!.subscribed).toBe(true);

    const c = device!.characteristic(TEST_UUIDS.customNotify);
    c.emit([0x50, 0x32, 0x31, 0x0d, 0x0a]);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ origin: 'notification' });
    expect(Array.from(data[0]!.bytes)).toEqual([0x50, 0x32, 0x31, 0x0d, 0x0a]);

    await transport.unsubscribe(id);
    expect(c.notifying).toBe(false);
    c.notifying = true; // even if the device keeps sending, nothing is logged
    c.emit([1]);
    expect(data).toHaveLength(1);
    expect(events).toEqual([true, false]);
  });

  it('labels indications', async () => {
    const c = new MockCharacteristic('0000aaaa-0000-1000-8000-00805f9b34fb', props('indicate'));
    const { transport, data } = setup(new MockDevice('d', 'D', [new MockService('0000bbbb-0000-1000-8000-00805f9b34fb', [c])]));
    await transport.connect();
    await transport.subscribe(transport.getServices()[0]!.characteristics[0]!.id);
    c.emit([7]);
    expect(data[0]!.origin).toBe('indication');
  });

  it('auto-subscribes after connecting when enabled', async () => {
    const { transport, device } = setup(undefined, { autoSubscribe: true });
    await transport.connect();
    expect(device!.characteristic(TEST_UUIDS.batteryLevel).notifying).toBe(true);
    expect(device!.characteristic(TEST_UUIDS.customNotify).notifying).toBe(true);
  });

  it('reports subscribe failures without breaking the connection', async () => {
    const device = createTestPeripheral();
    device.characteristic(TEST_UUIDS.batteryLevel).failNext.start = domError('NotSupportedError');
    const { transport, errors } = setup(device, { autoSubscribe: true });
    await transport.connect();
    expect(transport.state).toBe('connected');
    expect(errors.map((e) => e.code)).toEqual(['operationNotSupported']);
    expect(device.characteristic(TEST_UUIDS.customNotify).notifying).toBe(true);
  });

  it('writes with response by default, split into chunks', async () => {
    const { transport, device, opts } = setup();
    await transport.connect();
    opts.chunkSize = 4;
    const data = Uint8Array.from({ length: 10 }, (_, i) => i);
    const result = await transport.send(data);
    const writes = device!.characteristic(TEST_UUIDS.customWrite).writes;
    expect(writes.map((w) => w.bytes)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
    expect(writes.every((w) => w.withResponse)).toBe(true);
    expect(result.channel).toBe('12345678');
  });

  it('honours the "without response" write type', async () => {
    const { transport, device } = setup(undefined, { writeMode: 'withoutResponse' });
    await transport.connect();
    await transport.send(Uint8Array.of(1));
    expect(device!.characteristic(TEST_UUIDS.customWrite).writes[0]!.withResponse).toBe(false);
  });

  it('allows choosing the TX characteristic and validates it', async () => {
    const { transport } = setup();
    await transport.connect();
    expect(() => transport.setTxTarget(idOf(transport, TEST_UUIDS.batteryLevel))).toThrow(TransportError);
    transport.setTxTarget(undefined);
    expect(transport.canSend()).toBe(false);
    await expectCode(transport.send(Uint8Array.of(1)), 'noWritableChannel');
  });

  it('maps write failures', async () => {
    const { transport, device } = setup();
    await transport.connect();
    device!.characteristic(TEST_UUIDS.customWrite).failNext.write = domError('NetworkError', 'GATT operation failed');
    await expectCode(transport.send(Uint8Array.of(1)), 'writeFailed');
  });

  it('rejects operations when not connected', async () => {
    const { transport } = setup();
    await expectCode(transport.send(Uint8Array.of(1)), 'notConnected');
    await expect(transport.read('0:0')).rejects.toMatchObject({ code: 'notConnected' });
  });
});

describe('BluetoothTransport: disconnection', () => {
  it('user disconnect stops notifications and resets state', async () => {
    const { transport, device, states } = setup(undefined, { autoSubscribe: true });
    await transport.connect();
    await transport.disconnect();
    expect(transport.state).toBe('disconnected');
    expect(device!.gatt.connected).toBe(false);
    expect(device!.characteristic(TEST_UUIDS.customNotify).notifying).toBe(false);
    expect(transport.getServices()).toEqual([]);
    expect(states.at(-1)).toMatchObject({ state: 'disconnected', lost: false });
  });

  it('detects a lost connection', async () => {
    const { transport, device, states, data } = setup(undefined, { autoSubscribe: true });
    await transport.connect();
    device!.loseConnection();
    expect(transport.state).toBe('disconnected');
    expect(states.at(-1)).toMatchObject({ state: 'disconnected', lost: true });
    device!.characteristic(TEST_UUIDS.customNotify).emit([1]); // stale event
    expect(data).toHaveLength(0);
  });

  it('disconnect while the GATT connection is pending cancels the attempt', async () => {
    const { transport, device, states } = setup();
    const gate = deferred();
    device!.gatt.connectGate = gate.promise;
    const connecting = transport.connect();
    await settle();
    expect(transport.state).toBe('connecting');
    await transport.disconnect();
    gate.resolve();
    await expect(connecting).resolves.toBeUndefined();
    expect(transport.state).toBe('disconnected');
    expect(device!.gatt.connected).toBe(false); // the late connection is dropped
    expect(transport.getServices()).toEqual([]);
    expect(states.map((s) => s.state)).toEqual(['connecting', 'disconnecting', 'disconnected']);
    // A new attempt works normally.
    device!.gatt.connectGate = undefined;
    await transport.connect();
    expect(transport.state).toBe('connected');
  });

  it('device lost during discovery: reported once, no stale state', async () => {
    const { transport, device, states } = setup();
    const gate = deferred();
    device!.gatt.discoveryGate = gate.promise;
    const connecting = transport.connect();
    await settle();
    device!.loseConnection();
    gate.resolve();
    await expect(connecting).resolves.toBeUndefined();
    expect(transport.state).toBe('disconnected');
    expect(transport.getServices()).toEqual([]);
    expect(states.filter((s) => s.lost)).toHaveLength(1);
  });

  it('can reconnect after a disconnection', async () => {
    const { transport } = setup();
    await transport.connect();
    await transport.disconnect();
    await transport.connect();
    expect(transport.state).toBe('connected');
    expect(transport.getServices()).toHaveLength(2);
  });
});

describe('BLE helpers', () => {
  const p = (o: Partial<ReturnType<typeof props>>) => ({ ...props(), ...o });

  it('resolveWriteMode picks a supported type', () => {
    expect(resolveWriteMode(p({ write: true, writeWithoutResponse: true }), 'auto')).toBe('withResponse');
    expect(resolveWriteMode(p({ writeWithoutResponse: true }), 'auto')).toBe('withoutResponse');
    expect(resolveWriteMode(p({ write: true }), 'withoutResponse')).toBe('withResponse');
    expect(resolveWriteMode(p({ writeWithoutResponse: true }), 'withResponse')).toBe('withoutResponse');
  });

  it('chunkBytes clamps the chunk size', () => {
    expect(chunkBytes(Uint8Array.of(1, 2, 3), 0).length).toBe(3);
    expect(chunkBytes(new Uint8Array(1000), 9999).map((c) => c.length)).toEqual([512, 488]);
    expect(chunkBytes(new Uint8Array(0), 20)).toEqual([]);
  });

  it('pickDefaultTxTarget skips Generic Access and prefers custom services', () => {
    const svc = (uuid: string, charProps: ReturnType<typeof props>, id: string): BleServiceInfo => ({
      uuid,
      characteristics: [{ id, serviceUuid: uuid, uuid: 'x', properties: charProps, subscribed: false }],
    });
    const generic = svc('00001800-0000-1000-8000-00805f9b34fb', props('write'), 'ga');
    const sig = svc('0000180d-0000-1000-8000-00805f9b34fb', props('write'), 'hr');
    const custom = svc('12345678-0000-4000-8000-00000000a000', props('writeWithoutResponse'), 'c');
    expect(pickDefaultTxTarget([generic, sig, custom])).toBe('c');
    expect(pickDefaultTxTarget([generic, sig])).toBe('hr');
    expect(pickDefaultTxTarget([generic])).toBeUndefined();
  });
});
