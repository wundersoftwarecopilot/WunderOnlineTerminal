/**
 * Glue between transports and the log.
 *
 * The session only uses the generic `Transport` interface: the very same
 * code handles Bluetooth LE and serial ports.
 */
import { RxFramer, type FramingOptions } from '../core/framer';
import type { MessageKey, MessageParams } from '../i18n/i18n';
import { TransportError, toTransportError } from '../transport/errors';
import type { DataOrigin, Transport, TransportKind } from '../transport/types';
import type { LogEntry, TerminalLog } from './log';

export interface SessionOptions {
  /** RX grouping settings for a transport kind (read on every change). */
  framing: (kind: TransportKind) => FramingOptions;
}

export class TerminalSession {
  private readonly framers = new Map<string, RxFramer>();
  private readonly detachers = new Map<Transport, Array<() => void>>();

  constructor(
    readonly log: TerminalLog,
    private readonly options: SessionOptions,
  ) {}

  /** Starts logging the events of a transport. Returns a detach function. */
  attach(transport: Transport): () => void {
    const kind = transport.kind;
    const offs = [
      transport.on('data', (e) => this.receive(kind, e.bytes, e.channel, e.origin)),
      transport.on('state', (e) => {
        if (e.state === 'connected') {
          if (e.deviceName) this.info(kind, 'log.connected', { device: e.deviceName });
          else this.info(kind, 'log.connectedNoName');
        } else if (e.state === 'disconnected') {
          this.flush(kind);
          this.disposeFramers(kind);
          if (e.lost) this.log.append({ direction: 'error', transport: kind, message: { key: 'log.lost' } });
          else this.info(kind, 'log.disconnected');
        }
      }),
      transport.on('error', (e) => this.error(kind, e.error)),
    ];
    this.detachers.set(transport, offs);
    return () => this.detach(transport);
  }

  detach(transport: Transport): void {
    this.detachers.get(transport)?.forEach((off) => off());
    this.detachers.delete(transport);
    this.disposeFramers(transport.kind);
  }

  private framerKey(kind: TransportKind, channel: string | undefined, origin: DataOrigin): string {
    return `${kind}\u0000${channel ?? ''}\u0000${origin === 'read' ? 'read' : 'stream'}`;
  }

  /** Feeds received bytes through the framer of their channel. */
  receive(kind: TransportKind, bytes: Uint8Array, channel?: string, origin: DataOrigin = 'stream'): void {
    // A characteristic read is always a complete value: never regroup it.
    if (origin === 'read') {
      this.log.append({ direction: 'rx', transport: kind, data: bytes, channel, origin });
      return;
    }
    const key = this.framerKey(kind, channel, origin);
    let framer = this.framers.get(key);
    if (!framer) {
      framer = new RxFramer(this.options.framing(kind), (frame) =>
        this.log.append({ direction: 'rx', transport: kind, data: frame, channel, origin }),
      );
      this.framers.set(key, framer);
    }
    framer.push(bytes);
  }

  /** Emits pending RX data immediately. */
  flush(kind?: TransportKind): void {
    for (const [key, framer] of this.framers) {
      if (!kind || key.startsWith(kind + '\u0000')) framer.flush();
    }
  }

  /** Applies new RX grouping settings to open framers of a transport. */
  refreshFraming(kind: TransportKind): void {
    const options = this.options.framing(kind);
    for (const [key, framer] of this.framers) {
      if (key.startsWith(kind + '\u0000')) framer.setOptions(options);
    }
  }

  private disposeFramers(kind: TransportKind): void {
    for (const [key, framer] of [...this.framers]) {
      if (key.startsWith(kind + '\u0000')) {
        framer.dispose();
        this.framers.delete(key);
      }
    }
  }

  /**
   * Sends bytes through a transport and logs the outcome.
   * Returns true on success. Never throws.
   */
  async send(transport: Transport, bytes: Uint8Array): Promise<boolean> {
    try {
      const result = await transport.send(bytes);
      this.flush(transport.kind); // keep RX/TX ordering readable
      this.log.append({
        direction: 'tx',
        transport: transport.kind,
        data: bytes,
        channel: result.channel,
      });
      return true;
    } catch (err) {
      this.error(transport.kind, toTransportError(err, 'writeFailed'));
      return false;
    }
  }

  info(kind: TransportKind | undefined, key: MessageKey, params?: MessageParams): LogEntry {
    return this.log.append({ direction: 'info', transport: kind, message: { key, params } });
  }

  /** Logs an error. A user cancellation is logged as information. */
  error(kind: TransportKind | undefined, err: unknown): LogEntry {
    const e = err instanceof TransportError ? err : toTransportError(err, 'unknown');
    const key = `error.${e.code}` as MessageKey;
    return this.log.append({
      direction: e.code === 'cancelled' ? 'info' : 'error',
      transport: kind,
      message: { key, detail: e.detail },
    });
  }
}
