import { describe, expect, it } from 'vitest';
import { TransportError } from '../../src/transport/errors';
import { DEFAULT_SERIAL_CONFIG, type SerialConfig } from '../../src/transport/serial/serialConfig';
import { SerialTransport, describePort } from '../../src/transport/serial/SerialTransport';
import type { DataEvent, StateEvent } from '../../src/transport/types';
import { domError } from '../mocks/mockBluetooth';
import { MockSerial, MockSerialPort, deferred, settle } from '../mocks/mockSerial';

function setup(port: MockSerialPort | null = new MockSerialPort(), config: SerialConfig = { ...DEFAULT_SERIAL_CONFIG }) {
  const serial = new MockSerial(port);
  const transport = new SerialTransport({ serial, isSecureContext: () => true, getConfig: () => config });
  const data: DataEvent[] = [];
  const states: StateEvent[] = [];
  const errors: TransportError[] = [];
  transport.on('data', (e) => data.push(e));
  transport.on('state', (e) => states.push(e));
  transport.on('error', (e) => errors.push(e.error));
  return { serial, port, transport, data, states, errors, config };
}

const text = (events: DataEvent[]) => events.map((e) => new TextDecoder().decode(e.bytes)).join('');

describe('SerialTransport', () => {
  it('reports missing API', () => {
    const t = new SerialTransport({ serial: () => undefined, getConfig: () => DEFAULT_SERIAL_CONFIG });
    expect(t.checkSupport()).toEqual({ supported: false, reason: 'noApi' });
  });

  it('opens the port with 9600 8N1 and no flow control by default', async () => {
    const { transport, port, states } = setup();
    await transport.connect();
    expect(port!.openOptions).toMatchObject({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });
    expect(transport.state).toBe('connected');
    expect(transport.deviceName).toBe('USB 1234:5678');
    expect(transport.openConfig).toEqual(DEFAULT_SERIAL_CONFIG);
    expect(states.map((s) => s.state)).toEqual(['connecting', 'connected']);
    await transport.disconnect();
  });

  it('uses the configured line settings', async () => {
    const { transport, port } = setup(undefined, {
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: 'even',
      flowControl: 'hardware',
    });
    await transport.connect();
    expect(port!.openOptions).toMatchObject({
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: 'even',
      flowControl: 'hardware',
    });
    await transport.disconnect();
  });

  it('receives data (including binary) and transmits data', async () => {
    const { transport, port, data } = setup();
    await transport.connect();
    port!.receive('P21\r\n');
    port!.receive([0x00, 0xff]);
    await settle();
    expect(data.every((d) => d.origin === 'stream')).toBe(true);
    expect(Array.from(data[1]!.bytes)).toEqual([0x00, 0xff]);
    expect(text(data.slice(0, 1))).toBe('P21\r\n');

    await transport.send(new TextEncoder().encode('P22\r\n'));
    await Promise.all([transport.send(Uint8Array.of(1)), transport.send(Uint8Array.of(2))]);
    expect(port!.written).toEqual([[0x50, 0x32, 0x32, 0x0d, 0x0a], [1], [2]]);
    await transport.disconnect();
  });

  it('closes the port cleanly on user disconnect', async () => {
    const { transport, port, states } = setup();
    await transport.connect();
    await transport.disconnect();
    expect(transport.state).toBe('disconnected');
    expect(port!.readable).toBeNull();
    expect(port!.closeCalls).toBe(1);
    expect(states.at(-1)).toMatchObject({ state: 'disconnected', lost: false });
    // The port can be opened again.
    await transport.connect();
    expect(transport.state).toBe('connected');
    await transport.disconnect();
  });

  it('disconnect while the port is opening closes it again', async () => {
    const { transport, port } = setup();
    const gate = deferred();
    port!.openGate = gate.promise;
    const connecting = transport.connect();
    await settle();
    await transport.disconnect();
    gate.resolve();
    await expect(connecting).resolves.toBeUndefined();
    expect(transport.state).toBe('disconnected');
    expect(port!.readable).toBeNull();
    port!.openGate = undefined;
    await transport.connect();
    expect(transport.state).toBe('connected');
    await transport.disconnect();
  });

  it('detects an unplugged device', async () => {
    const { transport, port, states, errors } = setup();
    await transport.connect();
    port!.unplug();
    await settle();
    expect(transport.state).toBe('disconnected');
    expect(states.at(-1)).toMatchObject({ state: 'disconnected', lost: true });
    expect(errors).toEqual([]);
    await expect(transport.send(Uint8Array.of(1))).rejects.toMatchObject({ code: 'notConnected' });
  });

  it('keeps reading after recoverable line errors', async () => {
    const { transport, port, data, errors } = setup();
    await transport.connect();
    port!.lineError('ParityError');
    await settle();
    expect(errors.map((e) => [e.code, e.detail])).toEqual([['receiveError', 'ParityError']]);
    expect(transport.state).toBe('connected');
    port!.receive('ok');
    await settle();
    expect(text(data)).toBe('ok');
    await transport.disconnect();
  });

  it('maps a cancelled chooser and open failures', async () => {
    const cancelled = setup(null);
    await expect(cancelled.transport.connect()).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelled.transport.state).toBe('disconnected');

    const busyPort = new MockSerialPort();
    busyPort.openError = domError('InvalidStateError', 'The port is already open.');
    await expect(setup(busyPort).transport.connect()).rejects.toMatchObject({ code: 'busy' });

    const failPort = new MockSerialPort();
    failPort.openError = domError('NetworkError', 'Failed to open serial port.');
    const f = setup(failPort);
    await expect(f.transport.connect()).rejects.toMatchObject({ code: 'openFailed' });
    expect(f.transport.state).toBe('disconnected');

    const denied = setup();
    denied.serial.requestError = domError('SecurityError');
    await expect(denied.transport.connect()).rejects.toMatchObject({ code: 'permissionDenied' });
  });

  it('maps write errors', async () => {
    const { transport, port } = setup();
    await transport.connect();
    port!.writeError = domError('NetworkError', 'write failed');
    await expect(transport.send(Uint8Array.of(1))).rejects.toMatchObject({ code: 'writeFailed' });
    port!.writeError = undefined;
    await transport.disconnect();
  });

  it('describes ports without exposing more than USB ids', () => {
    expect(describePort({ usbVendorId: 0x2341, usbProductId: 0x43 })).toBe('USB 2341:0043');
    expect(describePort({ bluetoothServiceClassId: 0x1101 })).toBe('Bluetooth RFCOMM');
    expect(describePort({})).toBeUndefined();
    expect(describePort(undefined)).toBeUndefined();
  });
});
