/**
 * Generic serial (COM) port transport based on the Web Serial API.
 *
 * The port is chosen by the user through the browser picker and opened
 * with the line settings chosen in the UI. Bytes are passed through
 * untouched in both directions: no device-specific protocol is involved.
 */
import { Emitter } from '../../core/emitter';
import { TransportError, toTransportError } from '../errors';
import {
  checkApiSupport,
  type ConnectionState,
  type SendResult,
  type SupportStatus,
  type Transport,
  type TransportEvents,
} from '../types';
import { toSerialOptions, type SerialConfig } from './serialConfig';
import {
  getNavigatorSerial,
  type SerialLike,
  type SerialPortInfoLike,
  type SerialPortLike,
} from './webSerial';

/**
 * Read errors after which the port stays usable
 * (`port.readable` is replaced by a new stream).
 */
const RECOVERABLE_READ_ERRORS = new Set([
  'BreakError',
  'FramingError',
  'ParityError',
  'BufferOverrunError',
]);

export interface SerialTransportDeps {
  serial?: SerialLike | (() => SerialLike | undefined);
  isSecureContext?: () => boolean | undefined;
  getConfig: () => SerialConfig;
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0');
}

/** Human readable, non-localized port label (or undefined if unknown). */
export function describePort(info: SerialPortInfoLike | undefined): string | undefined {
  if (!info) return undefined;
  if (typeof info.usbVendorId === 'number' && typeof info.usbProductId === 'number') {
    return `USB ${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}`;
  }
  if (info.bluetoothServiceClassId !== undefined) return 'Bluetooth RFCOMM';
  return undefined;
}

export class SerialTransport implements Transport {
  readonly kind = 'serial' as const;

  private readonly emitter = new Emitter<TransportEvents>();
  private _state: ConnectionState = 'disconnected';
  private port: SerialPortLike | undefined;
  private portName: string | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private readLoop: Promise<void> | undefined;
  private keepReading = false;
  private writeChain: Promise<unknown> = Promise.resolve();
  private activeConfig: SerialConfig | undefined;
  private connectAttempt = 0;

  constructor(private readonly deps: SerialTransportDeps) {}

  get state(): ConnectionState {
    return this._state;
  }

  get deviceName(): string | undefined {
    return this.portName;
  }

  /** Configuration the port is currently open with. */
  get openConfig(): SerialConfig | undefined {
    return this.activeConfig;
  }

  on<K extends keyof TransportEvents>(
    event: K,
    listener: (payload: TransportEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  private get serial(): SerialLike | undefined {
    const s = this.deps.serial;
    if (typeof s === 'function') return s();
    return s ?? getNavigatorSerial();
  }

  checkSupport(): SupportStatus {
    const secure =
      this.deps.isSecureContext?.() ??
      (typeof window !== 'undefined' ? window.isSecureContext : undefined);
    return checkApiSupport(this.serial, secure);
  }

  canSend(): boolean {
    return this._state === 'connected' && !!this.port?.writable;
  }

  private setState(state: ConnectionState, lost = false): void {
    if (this._state === state) return;
    this._state = state;
    this.emitter.emit('state', { state, deviceName: this.portName, lost });
  }

  async connect(): Promise<void> {
    if (this._state !== 'disconnected') throw new TransportError('busy');
    const support = this.checkSupport();
    if (!support.supported) {
      throw new TransportError(support.reason === 'noApi' ? 'notSupported' : 'insecureContext');
    }
    const serial = this.serial!;
    // disconnect() while connecting bumps `connectAttempt`: the pending
    // attempt then gives up (closing the port if it was already opened).
    const attempt = ++this.connectAttempt;
    const current = (): boolean => attempt === this.connectAttempt;
    this.setState('connecting');

    let port: SerialPortLike;
    try {
      port = await serial.requestPort();
    } catch (err) {
      if (!current()) return;
      this.setState('disconnected');
      throw toTransportError(err, 'openFailed', 'request');
    }
    if (!current()) return;

    const config = this.deps.getConfig();
    try {
      await port.open(toSerialOptions(config));
    } catch (err) {
      if (!current()) return;
      this.setState('disconnected');
      const name = (err as { name?: string } | null)?.name;
      // InvalidStateError: already open (maybe by this page in another tab).
      throw toTransportError(err, name === 'InvalidStateError' ? 'busy' : 'openFailed');
    }
    if (!current()) {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
      return;
    }

    this.port = port;
    this.activeConfig = { ...config };
    let info: SerialPortInfoLike | undefined;
    try {
      info = port.getInfo();
    } catch {
      info = undefined;
    }
    this.portName = describePort(info);
    port.addEventListener('disconnect', this.onPortDisconnect);
    this.keepReading = true;
    this.setState('connected');
    this.readLoop = this.runReadLoop(port);
  }

  private async runReadLoop(port: SerialPortLike): Promise<void> {
    while (this.keepReading && port.readable) {
      let reader: ReadableStreamDefaultReader<Uint8Array>;
      try {
        reader = port.readable.getReader();
      } catch (err) {
        if (this.keepReading) {
          this.emitter.emit('error', { error: toTransportError(err, 'receiveError') });
        }
        break;
      }
      this.reader = reader;
      let recoverable = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            this.emitter.emit('data', { bytes: value, origin: 'stream' });
          }
        }
      } catch (err) {
        const name = (err as { name?: string } | null)?.name ?? '';
        recoverable = RECOVERABLE_READ_ERRORS.has(name);
        if (this.keepReading) {
          this.emitter.emit('error', {
            error: new TransportError('receiveError', name || String(err)),
          });
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        this.reader = undefined;
      }
      if (!recoverable) break;
    }

    if (this.keepReading) {
      // The stream ended without a user request: the device went away.
      await this.handleLost(true);
    }
  }

  private readonly onPortDisconnect = (): void => {
    if (this.keepReading) void this.handleLost(false);
  };

  /** Cleans up after the device disappeared (unplugged, powered off...). */
  private async handleLost(fromReadLoop: boolean): Promise<void> {
    if (!this.keepReading) return;
    this.keepReading = false;
    const port = this.port;
    if (!fromReadLoop) {
      try {
        await this.reader?.cancel();
      } catch {
        /* ignore */
      }
      try {
        await this.readLoop;
      } catch {
        /* ignore */
      }
    }
    this.readLoop = undefined;
    await this.releasePort(port);
    this.setState('disconnected', true);
  }

  private async releasePort(port: SerialPortLike | undefined): Promise<void> {
    if (this.writer) {
      try {
        await this.writer.abort();
      } catch {
        /* ignore */
      }
      this.writer = undefined;
    }
    if (port) {
      port.removeEventListener('disconnect', this.onPortDisconnect);
      try {
        await port.close();
      } catch {
        /* already closed or device gone */
      }
    }
    this.port = undefined;
    this.activeConfig = undefined;
  }

  async disconnect(): Promise<void> {
    if (this._state === 'disconnected' || this._state === 'disconnecting') return;
    this.connectAttempt++;
    this.keepReading = false;
    this.setState('disconnecting');
    const port = this.port;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      await this.readLoop;
    } catch {
      /* ignore */
    }
    this.readLoop = undefined;
    await this.releasePort(port);
    this.setState('disconnected');
  }

  async send(data: Uint8Array): Promise<SendResult> {
    if (this._state !== 'connected' || !this.port) throw new TransportError('notConnected');
    const port = this.port;
    const run = this.writeChain.then(async () => {
      const writable = port.writable;
      if (!writable || this.port !== port) throw new TransportError('notConnected');
      let writer: WritableStreamDefaultWriter<Uint8Array>;
      try {
        writer = writable.getWriter();
      } catch (err) {
        throw toTransportError(err, 'writeFailed');
      }
      this.writer = writer;
      try {
        await writer.write(data);
      } catch (err) {
        throw toTransportError(err, 'writeFailed');
      } finally {
        try {
          writer.releaseLock();
        } catch {
          /* ignore */
        }
        if (this.writer === writer) this.writer = undefined;
      }
      return {} as SendResult;
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}
