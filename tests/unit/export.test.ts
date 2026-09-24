import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, csvField, exportFilename, exportMimeType, toCsv, toTxt } from '../../src/export/exporters';
import { I18n } from '../../src/i18n/i18n';
import { createMemoryStorage } from '../../src/settings/storage';
import { TerminalLog } from '../../src/terminal/log';

const i18n = new I18n(createMemoryStorage(), ['en']);
const t = i18n.t.bind(i18n);
const enc = (s: string) => new TextEncoder().encode(s);

function sampleLog() {
  const base = new Date(2026, 8, 24, 10, 32, 1, 0).getTime();
  let n = 0;
  const log = new TerminalLog(100, () => base + 2000 * n++);
  log.append({ direction: 'info', transport: 'serial', message: { key: 'log.connected', params: { device: 'USB 1234:5678' } } });
  log.append({ direction: 'rx', transport: 'serial', data: enc('P21\r\n') });
  log.append({ direction: 'tx', transport: 'ble', data: enc('P22\r\n'), channel: 'UART RX' });
  log.append({ direction: 'rx', transport: 'ble', data: Uint8Array.of(0xff, 0x2c, 0x22) });
  log.append({ direction: 'error', transport: 'ble', message: { key: 'error.writeFailed', detail: 'GATT error' } });
  return log;
}

describe('exportFilename', () => {
  it('uses a local timestamp and the right extension', () => {
    const ms = new Date(2026, 8, 24, 10, 32, 1).getTime();
    expect(exportFilename('txt', ms)).toBe('online-terminal-20260924-103201.txt');
    expect(exportFilename('csv', ms)).toBe('online-terminal-20260924-103201.csv');
    expect(exportMimeType('csv')).toContain('text/csv');
    expect(exportMimeType('txt')).toContain('text/plain');
  });
});

describe('toTxt', () => {
  it('contains a header, timestamps, direction, hex and text', () => {
    const now = new Date(2026, 8, 24, 11, 0, 0).getTime();
    const txt = toTxt(sampleLog().entries, t, now);
    const lines = txt.trimEnd().split('\n');
    expect(lines[0]).toBe('# Online Terminal — session log');
    expect(lines[2]).toBe('# Entries: 5');
    expect(lines[4]).toBe('2026-09-24 10:32:01.000  SER   INFO  Connected to USB 1234:5678.');
    expect(lines[5]).toBe('2026-09-24 10:32:03.000  SER   RX    50 32 31 0D 0A  |  P21\\r\\n');
    expect(lines[6]).toBe('2026-09-24 10:32:05.000  BLE   TX    [UART RX]  50 32 32 0D 0A  |  P22\\r\\n');
    expect(lines[7]).toContain('FF 2C 22  |  \\xFF,"');
    expect(lines[8]).toContain('ERR   Write failed. (GATT error)');
  });
});

describe('toCsv', () => {
  it('produces RFC 4180 CSV with BOM and all columns', () => {
    const csv = toCsv(sampleLog().entries, t);
    expect(csv.startsWith('﻿')).toBe(true);
    const rows = csv.slice(1).trimEnd().split('\r\n');
    expect(rows[0]).toBe(CSV_COLUMNS.join(','));
    expect(rows).toHaveLength(6);
    expect(rows[2]).toMatch(/,serial,rx,,5,50 32 31 0D 0A,P21\\r\\n,$/);
    // Commas and quotes are escaped.
    expect(rows[4]).toContain(',"\\xFF,""",');
  });

  it('neutralizes spreadsheet formula injection', () => {
    expect(csvField('=1+2')).toBe("'=1+2");
    expect(csvField('+cmd')).toBe("'+cmd");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('-2')).toBe("'-2");
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(42)).toBe('42');
    expect(csvField('plain')).toBe('plain');
  });

  it('exports an empty log as just the header', () => {
    expect(toCsv([], t)).toBe('﻿' + CSV_COLUMNS.join(',') + '\r\n');
  });
});
