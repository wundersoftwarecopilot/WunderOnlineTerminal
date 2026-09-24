/**
 * In-memory Web Serial mock (generic byte pipe, no device protocol).
 */
import type {
  SerialLike,
  SerialOptionsLike,
  SerialPortInfoLike,
  SerialPortLike,
} from '../../src/transport/serial/webSerial';
import { domError } from './mockBluetooth';

export class MockSerialPort extends EventTarget implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  openOptions?: SerialOptionsLike;
  openError?: DOMException;
  openGate?: Promise<void>;
  writeError?: DOMException;
  readonly written: number[][] = [];
  closeCalls = 0;
  private controller?: ReadableStreamDefaultController<Uint8Array>;

  constructor(private readonly info: SerialPortInfoLike = { usbVendorId: 0x1234, usbProductId: 0x5678 }) {
    super();
  }

  getInfo(): SerialPortInfoLike {
    return this.info;
  }

  private makeReadable(): void {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  async open(options: SerialOptionsLike): Promise<void> {
    if (this.openGate) await this.openGate;
    if (this.openError) throw this.openError;
    if (this.readable) throw domError('InvalidStateError', 'The port is already open.');
    this.openOptions = options;
    this.makeReadable();
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (this.writeError) throw this.writeError;
        this.written.push(Array.from(chunk));
      },
    });
  }

  async close(): Promise<void> {
    this.closeCalls++;
    if (this.readable?.locked || this.writable?.locked) {
      throw new TypeError('Cannot close a port with locked streams');
    }
    this.readable = null;
    this.writable = null;
    this.controller = undefined;
  }

  /** Data sent by the device. */
  receive(bytes: number[] | Uint8Array | string): void {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : Uint8Array.from(bytes);
    this.controller?.enqueue(data);
  }

  /** Recoverable line error (e.g. framing / parity): a new stream is created. */
  lineError(name: 'FramingError' | 'ParityError' | 'BreakError' | 'BufferOverrunError'): void {
    const old = this.controller;
    this.makeReadable();
    old?.error(domError(name));
  }

  /** Simulates the USB adapter being unplugged. */
  unplug(): void {
    const old = this.controller;
    this.controller = undefined;
    old?.error(domError('NetworkError', 'The device has been lost.'));
    this.readable = null;
    this.writable = null;
    this.dispatchEvent(new Event('disconnect'));
  }
}

export class MockSerial implements SerialLike {
  nextPort: MockSerialPort | null;
  requestError?: DOMException;
  requests = 0;

  constructor(port: MockSerialPort | null) {
    this.nextPort = port;
  }

  async requestPort(): Promise<SerialPortLike> {
    this.requests++;
    if (this.requestError) throw this.requestError;
    if (!this.nextPort) throw domError('NotFoundError', 'No port selected by the user.');
    return this.nextPort;
  }
}

/** A promise plus its resolver. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Waits for pending stream reads / promise callbacks to settle. */
export async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
