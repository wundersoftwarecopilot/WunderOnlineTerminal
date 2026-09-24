/**
 * Common, transport-agnostic contract.
 *
 * The terminal only talks to this interface: it never knows whether the
 * bytes come from a Bluetooth Low Energy characteristic or from a serial
 * port. Transports are generic; they never implement any device-specific
 * protocol, handshake or command set.
 */
import type { TransportError } from './errors';

export type TransportKind = 'ble' | 'serial';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export type SupportStatus =
  | { supported: true }
  | { supported: false; reason: 'noApi' | 'insecureContext' };

/** How a chunk of received data was obtained (display hint only). */
export type DataOrigin = 'stream' | 'read' | 'notification' | 'indication';

export interface StateEvent {
  state: ConnectionState;
  deviceName?: string;
  /** Set when the connection was lost without a user request. */
  lost?: boolean;
}

export interface DataEvent {
  bytes: Uint8Array;
  /** Optional sub-channel label (e.g. a BLE characteristic). */
  channel?: string;
  origin: DataOrigin;
}

export interface ErrorEvent {
  error: TransportError;
}

export interface TransportEvents extends Record<string, unknown> {
  state: StateEvent;
  data: DataEvent;
  error: ErrorEvent;
}

export interface SendResult {
  /** Label of the channel the data was written to, if any. */
  channel?: string;
}

export interface Transport {
  readonly kind: TransportKind;
  readonly state: ConnectionState;
  readonly deviceName: string | undefined;

  checkSupport(): SupportStatus;
  /** Opens the browser device/port picker and connects. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** True when `send()` can currently be called. */
  canSend(): boolean;
  send(data: Uint8Array): Promise<SendResult>;

  on<K extends keyof TransportEvents>(
    event: K,
    listener: (payload: TransportEvents[K]) => void,
  ): () => void;
}

/** Helper for the shared "Web API + secure context" check. */
export function checkApiSupport(api: unknown, secure: boolean | undefined): SupportStatus {
  if (!api) return { supported: false, reason: 'noApi' };
  if (secure === false) return { supported: false, reason: 'insecureContext' };
  return { supported: true };
}
