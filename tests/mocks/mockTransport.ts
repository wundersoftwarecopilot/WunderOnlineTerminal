/** Minimal Transport implementation used to test the terminal alone. */
import { Emitter } from '../../src/core/emitter';
import { TransportError } from '../../src/transport/errors';
import type {
  ConnectionState,
  DataOrigin,
  SendResult,
  SupportStatus,
  Transport,
  TransportEvents,
  TransportKind,
} from '../../src/transport/types';

export class MockTransport implements Transport {
  private readonly emitter = new Emitter<TransportEvents>();
  state: ConnectionState = 'disconnected';
  deviceName: string | undefined = 'Loopback';
  readonly sent: Uint8Array[] = [];
  failSend?: TransportError;
  channel?: string;

  constructor(readonly kind: TransportKind = 'serial') {}

  checkSupport(): SupportStatus {
    return { supported: true };
  }

  async connect(): Promise<void> {
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.setState('disconnected');
  }

  canSend(): boolean {
    return this.state === 'connected';
  }

  async send(data: Uint8Array): Promise<SendResult> {
    if (this.state !== 'connected') throw new TransportError('notConnected');
    if (this.failSend) throw this.failSend;
    this.sent.push(data);
    return { channel: this.channel };
  }

  on<K extends keyof TransportEvents>(event: K, listener: (p: TransportEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }

  setState(state: ConnectionState, lost = false): void {
    this.state = state;
    this.emitter.emit('state', { state, deviceName: this.deviceName, lost });
  }

  receive(bytes: number[] | string, channel?: string, origin: DataOrigin = 'stream'): void {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : Uint8Array.from(bytes);
    this.emitter.emit('data', { bytes: data, channel, origin });
  }

  fail(error: TransportError): void {
    this.emitter.emit('error', { error });
  }
}
