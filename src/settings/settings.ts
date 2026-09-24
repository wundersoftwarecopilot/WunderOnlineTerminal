/**
 * Persistent user preferences (non-sensitive only).
 *
 * Stored: active mode, display options, send options and the last
 * connection settings. NOT stored: received/transmitted data, send
 * history, device identifiers.
 */
import { Emitter } from '../core/emitter';
import { FRAMING_MODES, MAX_IDLE_MS, MIN_IDLE_MS, type FramingMode } from '../core/framer';
import { LINE_ENDINGS, type LineEnding } from '../core/lineEnding';
import type { InputMode } from '../core/payload';
import { BLE_MAX_CHUNK, type BleWriteMode } from '../transport/ble/BluetoothTransport';
import {
  DEFAULT_SERIAL_CONFIG,
  sanitizeSerialConfig,
  type SerialConfig,
} from '../transport/serial/serialConfig';
import type { TransportKind } from '../transport/types';
import { STORAGE_KEYS, type KeyValueStorage } from './storage';

export type ViewMode = 'text' | 'hex' | 'mixed';
export const VIEW_MODES: readonly ViewMode[] = ['text', 'hex', 'mixed'];
export const INPUT_MODES: readonly InputMode[] = ['text', 'hex'];
export const TRANSPORT_KINDS: readonly TransportKind[] = ['ble', 'serial'];
export const BLE_WRITE_MODES: readonly BleWriteMode[] = ['auto', 'withResponse', 'withoutResponse'];

export interface RxSettings {
  framing: FramingMode;
  idleMs: number;
}

export interface BleSettings extends RxSettings {
  namePrefix: string;
  /** Free text, parsed with `parseUuidList()`. */
  extraServices: string;
  commonSerialServices: boolean;
  autoSubscribe: boolean;
  writeMode: BleWriteMode;
  chunkSize: number;
}

export interface SerialSettings extends SerialConfig, RxSettings {}

export interface AppSettings {
  mode: TransportKind;
  view: ViewMode;
  autoScroll: boolean;
  inputMode: InputMode;
  lineEnding: LineEnding;
  escapes: boolean;
  ble: BleSettings;
  serial: SerialSettings;
}

export const MAX_TEXT_SETTING_LENGTH = 2000;

export function defaultSettings(): AppSettings {
  return {
    mode: 'ble',
    view: 'text',
    autoScroll: true,
    inputMode: 'text',
    lineEnding: 'none',
    escapes: true,
    ble: {
      namePrefix: '',
      extraServices: '',
      commonSerialServices: true,
      autoSubscribe: true,
      writeMode: 'auto',
      chunkSize: 20,
      framing: 'none',
      idleMs: 50,
    },
    serial: {
      ...DEFAULT_SERIAL_CONFIG,
      framing: 'idle',
      idleMs: 50,
    },
  };
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_SETTING_LENGTH) : fallback;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Validates untrusted data (e.g. from localStorage) field by field. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const d = defaultSettings();
  const r = obj(raw);
  const b = obj(r.ble);
  const s = obj(r.serial);
  return {
    mode: pick(r.mode, TRANSPORT_KINDS, d.mode),
    view: pick(r.view, VIEW_MODES, d.view),
    autoScroll: bool(r.autoScroll, d.autoScroll),
    inputMode: pick(r.inputMode, INPUT_MODES, d.inputMode),
    lineEnding: pick(r.lineEnding, LINE_ENDINGS, d.lineEnding),
    escapes: bool(r.escapes, d.escapes),
    ble: {
      namePrefix: text(b.namePrefix, d.ble.namePrefix),
      extraServices: text(b.extraServices, d.ble.extraServices),
      commonSerialServices: bool(b.commonSerialServices, d.ble.commonSerialServices),
      autoSubscribe: bool(b.autoSubscribe, d.ble.autoSubscribe),
      writeMode: pick(b.writeMode, BLE_WRITE_MODES, d.ble.writeMode),
      chunkSize: int(b.chunkSize, 1, BLE_MAX_CHUNK, d.ble.chunkSize),
      framing: pick(b.framing, FRAMING_MODES, d.ble.framing),
      idleMs: int(b.idleMs, MIN_IDLE_MS, MAX_IDLE_MS, d.ble.idleMs),
    },
    serial: {
      ...sanitizeSerialConfig(s),
      framing: pick(s.framing, FRAMING_MODES, d.serial.framing),
      idleMs: int(s.idleMs, MIN_IDLE_MS, MAX_IDLE_MS, d.serial.idleMs),
    },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsPatch = DeepPartial<AppSettings>;

interface SettingsEvents extends Record<string, unknown> {
  change: AppSettings;
}

export class SettingsStore {
  private readonly emitter = new Emitter<SettingsEvents>();
  private current: AppSettings;

  constructor(private readonly storage: KeyValueStorage) {
    this.current = SettingsStore.load(storage);
  }

  static load(storage: KeyValueStorage): AppSettings {
    const raw = storage.get(STORAGE_KEYS.settings);
    if (!raw) return defaultSettings();
    try {
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      return defaultSettings();
    }
  }

  get value(): AppSettings {
    return this.current;
  }

  update(patch: SettingsPatch): void {
    const merged = {
      ...this.current,
      ...patch,
      ble: { ...this.current.ble, ...(patch.ble ?? {}) },
      serial: { ...this.current.serial, ...(patch.serial ?? {}) },
    };
    this.current = sanitizeSettings(merged);
    this.storage.set(STORAGE_KEYS.settings, JSON.stringify(this.current));
    this.emitter.emit('change', this.current);
  }

  /** Restores the default communication settings of one transport. */
  resetTransport(kind: TransportKind): void {
    const d = defaultSettings();
    this.update(kind === 'ble' ? { ble: d.ble } : { serial: d.serial });
  }

  onChange(listener: (settings: AppSettings) => void): () => void {
    return this.emitter.on('change', listener);
  }
}
