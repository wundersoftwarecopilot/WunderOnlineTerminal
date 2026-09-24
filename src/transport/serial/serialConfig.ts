import type { DataBits, FlowControl, Parity, SerialOptionsLike, StopBits } from './webSerial';

/** User-editable serial line configuration. */
export interface SerialConfig {
  baudRate: number;
  dataBits: DataBits;
  stopBits: StopBits;
  parity: Parity;
  flowControl: FlowControl;
}

/** Defaults requested by the specification: 9600 8N1, no flow control. */
export const DEFAULT_SERIAL_CONFIG: Readonly<SerialConfig> = Object.freeze({
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
});

/** Common baud rates offered in the UI (a custom value is also allowed). */
export const COMMON_BAUD_RATES: readonly number[] = [
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
];

export const DATA_BITS: readonly DataBits[] = [8, 7];
export const STOP_BITS: readonly StopBits[] = [1, 2];
export const PARITIES: readonly Parity[] = ['none', 'even', 'odd'];
export const FLOW_CONTROLS: readonly FlowControl[] = ['none', 'hardware'];

export const MIN_BAUD_RATE = 1;
export const MAX_BAUD_RATE = 16_000_000;

/** Size of the browser-side receive buffer (bytes). */
export const SERIAL_BUFFER_SIZE = 4096;

export function isValidBaudRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_BAUD_RATE &&
    value <= MAX_BAUD_RATE
  );
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Returns a valid configuration, replacing invalid fields with defaults. */
export function sanitizeSerialConfig(raw: unknown): SerialConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    baudRate: isValidBaudRate(r.baudRate) ? r.baudRate : DEFAULT_SERIAL_CONFIG.baudRate,
    dataBits: pick(r.dataBits, DATA_BITS, DEFAULT_SERIAL_CONFIG.dataBits),
    stopBits: pick(r.stopBits, STOP_BITS, DEFAULT_SERIAL_CONFIG.stopBits),
    parity: pick(r.parity, PARITIES, DEFAULT_SERIAL_CONFIG.parity),
    flowControl: pick(r.flowControl, FLOW_CONTROLS, DEFAULT_SERIAL_CONFIG.flowControl),
  };
}

/** Options object passed to `SerialPort.open()`. */
export function toSerialOptions(config: SerialConfig): SerialOptionsLike {
  const c = sanitizeSerialConfig(config);
  return {
    baudRate: c.baudRate,
    dataBits: c.dataBits,
    stopBits: c.stopBits,
    parity: c.parity,
    flowControl: c.flowControl,
    bufferSize: SERIAL_BUFFER_SIZE,
  };
}

/** Compact notation, e.g. `9600 8N1`. */
export function describeSerialConfig(config: SerialConfig): string {
  const parity = config.parity === 'none' ? 'N' : config.parity === 'even' ? 'E' : 'O';
  const flow = config.flowControl === 'hardware' ? ' RTS/CTS' : '';
  return `${config.baudRate} ${config.dataBits}${parity}${config.stopBits}${flow}`;
}
