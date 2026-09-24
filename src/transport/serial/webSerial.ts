/**
 * Minimal structural types for the subset of the Web Serial API used by
 * the terminal (declared locally so tests can use lightweight mocks).
 */

export type DataBits = 7 | 8;
export type StopBits = 1 | 2;
export type Parity = 'none' | 'even' | 'odd';
export type FlowControl = 'none' | 'hardware';

export interface SerialOptionsLike {
  baudRate: number;
  dataBits?: DataBits;
  stopBits?: StopBits;
  parity?: Parity;
  bufferSize?: number;
  flowControl?: FlowControl;
}

export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: number | string;
}

export interface SerialPortLike extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptionsLike): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfoLike;
}

export interface SerialLike {
  requestPort(options?: unknown): Promise<SerialPortLike>;
}

/** Returns `navigator.serial` when available. */
export function getNavigatorSerial(): SerialLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
  return serial ?? undefined;
}
