/**
 * Session log export (.txt and .csv), generated entirely in the browser.
 */
import type { LogEntry } from '../terminal/log';
import {
  channelLabel,
  directionLabel,
  entryHex,
  entryMessage,
  entryText,
  formatDateTime,
  formatIso,
  transportLabel,
  type Translate,
} from '../terminal/format';

export type ExportFormat = 'txt' | 'csv';

/** `online-terminal-20260924-103201.txt` (local time). */
export function exportFilename(format: ExportFormat, now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
  return `online-terminal-${stamp}.${format}`;
}

/**
 * Plain text export: one line per entry with timestamp, transport,
 * direction, channel, HEX and escaped text.
 */
export function toTxt(entries: readonly LogEntry[], t: Translate, now: number = Date.now()): string {
  const lines: string[] = [
    `# ${t('export.title')}`,
    `# ${t('export.exportedAt')}: ${formatDateTime(now)} (${formatIso(now)})`,
    `# ${t('export.entries')}: ${entries.length}`,
    '',
  ];
  for (const e of entries) {
    const head = [
      formatDateTime(e.time),
      transportLabel(e, t).padEnd(4),
      directionLabel(e, t).padEnd(4),
    ];
    const channel = channelLabel(e, t);
    if (channel) head.push(`[${channel}]`);
    if (e.data) {
      const hex = entryHex(e);
      const text = entryText(e);
      lines.push(`${head.join('  ')}  ${hex}${hex ? '  |  ' : ''}${text}`);
    } else {
      lines.push(`${head.join('  ')}  ${entryMessage(e, t)}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Escapes a CSV field (RFC 4180) and neutralizes spreadsheet formula
 * injection: values starting with = + - @ (or tab/CR) are prefixed with
 * an apostrophe so spreadsheet programs treat them as text.
 */
export function csvField(value: string | number): string {
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_COLUMNS = [
  'timestamp_iso',
  'local_time',
  'transport',
  'direction',
  'channel',
  'bytes',
  'hex',
  'text',
  'message',
] as const;

/** CSV export (UTF-8 with BOM, CRLF line endings). */
export function toCsv(entries: readonly LogEntry[], t: Translate): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const e of entries) {
    rows.push(
      [
        formatIso(e.time),
        formatDateTime(e.time),
        e.transport ?? '',
        e.direction,
        channelLabel(e, t),
        e.data ? e.data.length : '',
        entryHex(e),
        entryText(e),
        entryMessage(e, t),
      ]
        .map(csvField)
        .join(','),
    );
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

export function exportMimeType(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
}
