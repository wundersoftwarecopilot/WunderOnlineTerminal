/**
 * Formatting of log entries (pure functions, shared by the view and the
 * exporters).
 */
import { bytesToDisplayText, bytesToHex, decodeForDisplay, type DisplaySegment } from '../core/bytes';
import type { MessageKey, MessageParams } from '../i18n/i18n';
import type { LogEntry } from './log';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Local time `HH:MM:SS.mmm`. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Local date and time `YYYY-MM-DD HH:MM:SS.mmm`. */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(ms)}`;
}

/** ISO 8601 UTC timestamp. */
export function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function entryHex(entry: LogEntry): string {
  return entry.data ? bytesToHex(entry.data) : '';
}

export function entryText(entry: LogEntry): string {
  return entry.data ? bytesToDisplayText(entry.data) : '';
}

export function entrySegments(entry: LogEntry): DisplaySegment[] {
  return entry.data ? decodeForDisplay(entry.data) : [];
}

/** Localized text of an INFO / ERROR entry. */
export function entryMessage(entry: LogEntry, t: Translate): string {
  const m = entry.message;
  if (!m) return '';
  const message = t(m.key, m.params);
  return m.detail ? t('error.withDetail', { message, detail: m.detail }) : message;
}

/** Localized direction label (RX, TX, INFO, ERR). */
export function directionLabel(entry: LogEntry, t: Translate): string {
  return t(`dir.${entry.direction}` as MessageKey);
}

/** Localized transport tag (BLE, SER) or empty. */
export function transportLabel(entry: LogEntry, t: Translate): string {
  return entry.transport ? t(`tag.${entry.transport}` as MessageKey) : '';
}

/** Channel label with optional origin, e.g. `0x2A19 Battery Level · read`. */
export function channelLabel(entry: LogEntry, t: Translate): string {
  const origin =
    entry.origin && entry.origin !== 'stream' ? t(`origin.${entry.origin}` as MessageKey) : '';
  if (entry.channel && origin) return `${entry.channel} · ${origin}`;
  return entry.channel ?? origin;
}
