import { describe, expect, it } from 'vitest';
import { SettingsStore, defaultSettings, sanitizeSettings } from '../../src/settings/settings';
import {
  STORAGE_KEYS,
  createBrowserStorage,
  createMemoryStorage,
} from '../../src/settings/storage';
import {
  COMMON_BAUD_RATES,
  DEFAULT_SERIAL_CONFIG,
  describeSerialConfig,
  sanitizeSerialConfig,
  toSerialOptions,
} from '../../src/transport/serial/serialConfig';

describe('serial defaults', () => {
  it('are 9600 baud, 8 data bits, 1 stop bit, no parity, no flow control', () => {
    expect(DEFAULT_SERIAL_CONFIG).toEqual({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });
    const d = defaultSettings().serial;
    expect([d.baudRate, d.dataBits, d.stopBits, d.parity, d.flowControl]).toEqual([
      9600,
      8,
      1,
      'none',
      'none',
    ]);
    expect(describeSerialConfig(DEFAULT_SERIAL_CONFIG)).toBe('9600 8N1');
  });

  it('offers the common baud rates', () => {
    for (const rate of [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]) {
      expect(COMMON_BAUD_RATES).toContain(rate);
    }
  });

  it('builds SerialPort.open() options', () => {
    expect(
      toSerialOptions({ baudRate: 115200, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' }),
    ).toMatchObject({ baudRate: 115200, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' });
    expect(describeSerialConfig({ baudRate: 19200, dataBits: 7, stopBits: 2, parity: 'odd', flowControl: 'hardware' })).toBe(
      '19200 7O2 RTS/CTS',
    );
  });

  it('replaces invalid values with defaults', () => {
    expect(
      sanitizeSerialConfig({ baudRate: -5, dataBits: 6, stopBits: 3, parity: 'mark', flowControl: 'xon' }),
    ).toEqual(DEFAULT_SERIAL_CONFIG);
    expect(sanitizeSerialConfig({ baudRate: 250000 }).baudRate).toBe(250000); // custom rate
    expect(sanitizeSerialConfig({ baudRate: 9600.5 }).baudRate).toBe(9600);
    expect(sanitizeSerialConfig(null)).toEqual(DEFAULT_SERIAL_CONFIG);
  });
});

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(undefined)).toEqual(defaultSettings());
    expect(sanitizeSettings('x')).toEqual(defaultSettings());
    expect(sanitizeSettings([1, 2])).toEqual(defaultSettings());
  });
  it('keeps valid values and fixes invalid ones field by field', () => {
    const s = sanitizeSettings({
      mode: 'serial',
      view: 'hex',
      autoScroll: false,
      inputMode: 'nope',
      lineEnding: 'crlf',
      ble: { chunkSize: 9999, writeMode: 'withoutResponse', namePrefix: 42 },
      serial: { baudRate: 115200, framing: 'lf', idleMs: 0 },
    });
    expect(s.mode).toBe('serial');
    expect(s.view).toBe('hex');
    expect(s.autoScroll).toBe(false);
    expect(s.inputMode).toBe('text');
    expect(s.lineEnding).toBe('crlf');
    expect(s.ble.chunkSize).toBe(20);
    expect(s.ble.writeMode).toBe('withoutResponse');
    expect(s.ble.namePrefix).toBe('');
    expect(s.serial.baudRate).toBe(115200);
    expect(s.serial.framing).toBe('lf');
    expect(s.serial.idleMs).toBe(50);
  });
});

describe('SettingsStore', () => {
  it('persists only preferences and restores them', () => {
    const storage = createMemoryStorage();
    const store = new SettingsStore(storage);
    const seen: string[] = [];
    store.onChange((s) => seen.push(s.view));
    store.update({ view: 'mixed', serial: { baudRate: 57600 } });
    expect(seen).toEqual(['mixed']);
    expect(store.value.serial.dataBits).toBe(8); // untouched fields kept

    const reloaded = new SettingsStore(storage);
    expect(reloaded.value.view).toBe('mixed');
    expect(reloaded.value.serial.baudRate).toBe(57600);

    const saved = JSON.parse(storage.get(STORAGE_KEYS.settings)!);
    expect(Object.keys(saved).sort()).toEqual(
      ['autoScroll', 'ble', 'escapes', 'inputMode', 'lineEnding', 'mode', 'serial', 'view'].sort(),
    );
  });

  it('restores transport defaults', () => {
    const store = new SettingsStore(createMemoryStorage());
    store.update({ serial: { baudRate: 115200, parity: 'even' }, ble: { chunkSize: 100 } });
    store.resetTransport('serial');
    expect(store.value.serial.baudRate).toBe(9600);
    expect(store.value.serial.parity).toBe('none');
    expect(store.value.ble.chunkSize).toBe(100);
  });

  it('survives corrupted storage', () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.settings]: '{not json' });
    expect(new SettingsStore(storage).value).toEqual(defaultSettings());
  });

  it('browser storage wrapper never throws when localStorage is unavailable', () => {
    const storage = createBrowserStorage(); // no localStorage in the node environment
    expect(() => storage.set('a', 'b')).not.toThrow();
    expect(storage.get('a')).toBeNull();
    expect(() => storage.remove('a')).not.toThrow();
  });
});
