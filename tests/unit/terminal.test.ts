import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18n } from '../../src/i18n/i18n';
import { createMemoryStorage } from '../../src/settings/storage';
import {
  channelLabel,
  directionLabel,
  entryHex,
  entryMessage,
  entryText,
  formatDateTime,
  formatTime,
  transportLabel,
} from '../../src/terminal/format';
import { TerminalLog } from '../../src/terminal/log';
import { TerminalSession } from '../../src/terminal/session';
import { TransportError } from '../../src/transport/errors';
import type { FramingOptions } from '../../src/core/framer';
import { MockTransport } from '../mocks/mockTransport';

const t = (() => {
  const i18n = new I18n(createMemoryStorage(), ['en']);
  return i18n.t.bind(i18n);
})();

function setup(framing: FramingOptions = { mode: 'none', idleMs: 50 }) {
  let clock = Date.UTC(2026, 8, 24, 8, 32, 1, 123);
  const log = new TerminalLog(100, () => clock++);
  const session = new TerminalSession(log, { framing: () => framing });
  const serial = new MockTransport('serial');
  const ble = new MockTransport('ble');
  session.attach(serial);
  session.attach(ble);
  return { log, session, serial, ble };
}

describe('TerminalLog', () => {
  it('assigns ids and timestamps and counts bytes', () => {
    const log = new TerminalLog(10, () => 1000);
    const a = log.append({ direction: 'rx', data: Uint8Array.of(1, 2, 3) });
    const b = log.append({ direction: 'tx', data: Uint8Array.of(4) });
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(a.time).toBe(1000);
    expect(log.stats).toEqual({ rxBytes: 3, txBytes: 1, rxCount: 1, txCount: 1 });
  });

  it('clear() empties the log and resets counters', () => {
    const log = new TerminalLog();
    const cleared = vi.fn();
    log.on('clear', cleared);
    log.append({ direction: 'rx', data: Uint8Array.of(1) });
    log.clear();
    expect(log.size).toBe(0);
    expect(log.stats.rxBytes).toBe(0);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('keeps memory bounded', () => {
    const log = new TerminalLog(100);
    for (let i = 0; i < 1000; i++) log.append({ direction: 'rx', data: Uint8Array.of(i & 0xff) });
    expect(log.size).toBeLessThanOrEqual(100);
    expect(log.entries[log.size - 1]!.id).toBe(1000);
  });
});

describe('TerminalSession (transport-agnostic)', () => {
  it('logs RX data with transport and timestamp', () => {
    const { log, serial, ble } = setup();
    serial.receive('P21\r\n');
    ble.receive([0x01, 0x02], '0x2A19 Battery Level', 'notification');
    expect(log.entries.map((e) => [e.transport, e.direction, entryText(e)])).toEqual([
      ['serial', 'rx', 'P21\\r\\n'],
      ['ble', 'rx', '\\x01\\x02'],
    ]);
    expect(log.entries[1]!.channel).toBe('0x2A19 Battery Level');
    expect(typeof log.entries[0]!.time).toBe('number');
  });

  it('logs TX after a successful send', async () => {
    const { log, session, serial } = setup();
    await serial.connect();
    const ok = await session.send(serial, new TextEncoder().encode('HELLO\r\n'));
    expect(ok).toBe(true);
    expect(serial.sent).toHaveLength(1);
    const tx = log.entries.at(-1)!;
    expect(tx.direction).toBe('tx');
    expect(entryHex(tx)).toBe('48 45 4C 4C 4F 0D 0A');
  });

  it('logs an error (and no TX) when sending fails', async () => {
    const { log, session, serial } = setup();
    const ok = await session.send(serial, Uint8Array.of(1));
    expect(ok).toBe(false);
    const last = log.entries.at(-1)!;
    expect(last.direction).toBe('error');
    expect(entryMessage(last, t)).toBe('Not connected.');

    await serial.connect();
    serial.failSend = new TransportError('writeFailed', 'NetworkError: boom');
    await session.send(serial, Uint8Array.of(1));
    expect(entryMessage(log.entries.at(-1)!, t)).toBe('Write failed. (NetworkError: boom)');
    expect(log.stats.txBytes).toBe(0);
  });

  it('logs connection state changes, including lost connections', async () => {
    const { log, serial } = setup();
    await serial.connect();
    serial.setState('disconnected', true);
    serial.deviceName = undefined;
    serial.setState('connected');
    await serial.disconnect();
    expect(log.entries.map((e) => entryMessage(e, t))).toEqual([
      'Connected to Loopback.',
      'Connection lost.',
      'Connected.',
      'Disconnected.',
    ]);
    expect(log.entries[1]!.direction).toBe('error');
  });

  it('logs a cancelled chooser as information, other errors as errors', () => {
    const { log, session } = setup();
    session.error('ble', new TransportError('cancelled'));
    session.error('ble', new TransportError('permissionDenied'));
    session.error('serial', new Error('weird'));
    expect(log.entries.map((e) => e.direction)).toEqual(['info', 'error', 'error']);
    expect(entryMessage(log.entries[0]!, t)).toBe('No device selected.');
    expect(entryMessage(log.entries[2]!, t)).toBe('Unexpected error. (weird)');
  });

  it('forwards transport error events', () => {
    const { log, serial } = setup();
    serial.fail(new TransportError('receiveError', 'ParityError'));
    expect(entryMessage(log.entries[0]!, t)).toBe('Receive error. (ParityError)');
  });

  describe('RX grouping', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('groups fragmented serial data per the framing settings', () => {
      const { log, serial } = setup({ mode: 'lf', idleMs: 20 });
      serial.receive('P2');
      serial.receive('1\r\nP2');
      expect(log.entries.map(entryText)).toEqual(['P21\\r\\n']);
      vi.advanceTimersByTime(20);
      expect(log.entries.map(entryText)).toEqual(['P21\\r\\n', 'P2']);
    });

    it('keeps different channels separate and never regroups reads', () => {
      const { log, ble } = setup({ mode: 'idle', idleMs: 20 });
      ble.receive('a', 'A');
      ble.receive('b', 'B');
      ble.receive('r', 'A', 'read');
      expect(log.entries.map(entryText)).toEqual(['r']);
      vi.advanceTimersByTime(20);
      expect(log.entries.map((e) => `${e.channel}:${entryText(e)}`).sort()).toEqual([
        'A:a',
        'A:r',
        'B:b',
      ]);
    });

    it('flushes pending RX before logging TX and on disconnect', async () => {
      const { log, session, serial } = setup({ mode: 'idle', idleMs: 1000 });
      await serial.connect();
      serial.receive('abc');
      await session.send(serial, Uint8Array.of(0x41));
      expect(log.entries.slice(1).map((e) => e.direction)).toEqual(['rx', 'tx']);
      serial.receive('zzz');
      await serial.disconnect();
      expect(log.entries.slice(-2).map((e) => e.direction)).toEqual(['rx', 'info']);
    });
  });
});

describe('format', () => {
  it('formats timestamps with milliseconds', () => {
    const ms = new Date(2026, 8, 24, 10, 32, 1, 7).getTime();
    expect(formatTime(ms)).toBe('10:32:01.007');
    expect(formatDateTime(ms)).toBe('2026-09-24 10:32:01.007');
  });

  it('labels direction, transport and channel', () => {
    const log = new TerminalLog();
    const e = log.append({
      direction: 'rx',
      transport: 'ble',
      data: Uint8Array.of(0x50),
      channel: '0x2A19 Battery Level',
      origin: 'read',
    });
    expect(directionLabel(e, t)).toBe('RX');
    expect(transportLabel(e, t)).toBe('BLE');
    expect(channelLabel(e, t)).toBe('0x2A19 Battery Level · read');
    const s = log.append({ direction: 'tx', transport: 'serial', data: Uint8Array.of(1) });
    expect(transportLabel(s, t)).toBe('SER');
    expect(channelLabel(s, t)).toBe('');
  });
});
