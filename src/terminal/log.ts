/**
 * In-memory communication log.
 *
 * The log lives only in memory for the current page session: it is never
 * persisted nor sent anywhere. It can be exported explicitly by the user.
 */
import { Emitter } from '../core/emitter';
import type { MessageKey, MessageParams } from '../i18n/i18n';
import type { DataOrigin, TransportKind } from '../transport/types';

export type Direction = 'rx' | 'tx' | 'info' | 'error';

export interface LogMessage {
  key: MessageKey;
  params?: MessageParams;
  /** Raw technical detail (e.g. browser error text), not translated. */
  detail?: string;
}

export interface LogEntry {
  readonly id: number;
  /** Epoch milliseconds. */
  readonly time: number;
  readonly direction: Direction;
  readonly transport?: TransportKind;
  /** Payload for RX / TX entries. */
  readonly data?: Uint8Array;
  readonly channel?: string;
  readonly origin?: DataOrigin;
  /** Message for INFO / ERROR entries. */
  readonly message?: LogMessage;
}

export type NewLogEntry = Omit<LogEntry, 'id' | 'time'> & { time?: number };

export interface LogStats {
  rxBytes: number;
  txBytes: number;
  rxCount: number;
  txCount: number;
}

interface LogEvents extends Record<string, unknown> {
  append: LogEntry;
  clear: undefined;
  trim: number;
}

export const DEFAULT_MAX_ENTRIES = 50_000;

export class TerminalLog {
  private readonly emitter = new Emitter<LogEvents>();
  private list: LogEntry[] = [];
  private nextId = 1;
  private _stats: LogStats = { rxBytes: 0, txBytes: 0, rxCount: 0, txCount: 0 };

  constructor(
    readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get entries(): readonly LogEntry[] {
    return this.list;
  }

  get size(): number {
    return this.list.length;
  }

  get stats(): Readonly<LogStats> {
    return this._stats;
  }

  append(input: NewLogEntry): LogEntry {
    const entry: LogEntry = { ...input, id: this.nextId++, time: input.time ?? this.now() };
    this.list.push(entry);
    if (entry.data) {
      if (entry.direction === 'rx') {
        this._stats.rxBytes += entry.data.length;
        this._stats.rxCount++;
      } else if (entry.direction === 'tx') {
        this._stats.txBytes += entry.data.length;
        this._stats.txCount++;
      }
    }
    this.emitter.emit('append', entry);
    if (this.list.length > this.maxEntries) {
      // Drop the oldest ~10% at once to keep trimming cheap.
      const excess = this.list.length - this.maxEntries;
      const drop = Math.max(excess, Math.floor(this.maxEntries / 10));
      this.list.splice(0, drop);
      this.emitter.emit('trim', drop);
    }
    return entry;
  }

  clear(): void {
    this.list = [];
    this._stats = { rxBytes: 0, txBytes: 0, rxCount: 0, txCount: 0 };
    this.emitter.emit('clear', undefined);
  }

  on<K extends keyof LogEvents>(event: K, listener: (payload: LogEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }
}
