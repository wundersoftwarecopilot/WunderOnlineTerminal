import { describe, expect, it } from 'vitest';
import {
  COMMON_SERIAL_SERVICES,
  SIG_SERVICE_RANGE,
  buildOptionalServices,
  characteristicName,
  serviceName,
} from '../../src/transport/ble/knownUuids';
import {
  formatUuid,
  isSigUuid,
  normalizeUuid,
  parseUuidList,
  shortUuid,
  sigAlias,
  uuidFromAlias,
} from '../../src/transport/ble/uuid';

describe('uuid helpers', () => {
  it('normalizes 16-bit, 32-bit and 128-bit forms', () => {
    const battery = '0000180f-0000-1000-8000-00805f9b34fb';
    expect(normalizeUuid('180F')).toBe(battery);
    expect(normalizeUuid('0x180f')).toBe(battery);
    expect(normalizeUuid('0000180F')).toBe(battery);
    expect(normalizeUuid(' 0000180F-0000-1000-8000-00805F9B34FB ')).toBe(battery);
    expect(normalizeUuid('0000180f0000100080000080 5f9b34fb'.replace(' ', ''))).toBe(battery);
    expect(normalizeUuid('xyz')).toBeNull();
    expect(normalizeUuid('180')).toBeNull();
    expect(normalizeUuid('0000180f-0000-1000-8000-00805f9b34fbXX')).toBeNull();
  });

  it('formats SIG and custom UUIDs', () => {
    expect(uuidFromAlias(0x2a19)).toBe('00002a19-0000-1000-8000-00805f9b34fb');
    expect(isSigUuid(uuidFromAlias(0x2a19))).toBe(true);
    expect(sigAlias(uuidFromAlias(0x2a19))).toBe(0x2a19);
    expect(formatUuid(uuidFromAlias(0x2a19))).toBe('0x2A19');
    const custom = '12345678-0000-4000-8000-00000000a000';
    expect(isSigUuid(custom)).toBe(false);
    expect(formatUuid(custom)).toBe(custom);
    expect(shortUuid(custom)).toBe('12345678');
  });

  it('parses a user list and reports invalid entries', () => {
    expect(parseUuidList('180F, fff0\n 180f; bogus')).toEqual({
      uuids: [uuidFromAlias(0x180f), uuidFromAlias(0xfff0)],
      invalid: ['bogus'],
    });
    expect(parseUuidList('')).toEqual({ uuids: [], invalid: [] });
  });
});

describe('optional services', () => {
  it('always requests the full SIG GATT service range', () => {
    const list = buildOptionalServices({ includeCommonSerial: false, extra: [] });
    expect(list[0]).toBe(SIG_SERVICE_RANGE.first);
    expect(list).toContain(0x180f);
    expect(list).toHaveLength(SIG_SERVICE_RANGE.last - SIG_SERVICE_RANGE.first + 1);
  });

  it('adds common serial profiles and user UUIDs without duplicates', () => {
    const extra = ['abcdef01-2345-6789-abcd-ef0123456789', uuidFromAlias(0x180f)];
    const list = buildOptionalServices({ includeCommonSerial: true, extra });
    for (const s of COMMON_SERIAL_SERVICES) expect(list).toContain(s.uuid);
    expect(list).toContain('abcdef01-2345-6789-abcd-ef0123456789');
    expect(list.filter((x) => x === uuidFromAlias(0x180f))).toHaveLength(0); // already as 0x180F
    expect(new Set(list).size).toBe(list.length);
  });

  it('knows display names of common services and characteristics', () => {
    expect(serviceName(uuidFromAlias(0x180a))).toBe('Device Information');
    expect(characteristicName(uuidFromAlias(0x2a29))).toBe('Manufacturer Name String');
    expect(serviceName('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toBe('Nordic UART Service');
    expect(serviceName('12345678-0000-4000-8000-00000000a000')).toBeUndefined();
  });
});
