import { concatBytes, utf8SafeSplitIndex } from './bytes';

/**
 * How received bytes are grouped into terminal lines.
 *
 * - `none`: every chunk delivered by the transport is shown as-is.
 * - `idle`: consecutive chunks are merged until the line is quiet for
 *   `idleMs` milliseconds (useful for serial ports, where the browser
 *   delivers data in arbitrary pieces).
 * - `lf`: like `idle`, but a line is also closed right after every LF
 *   (0x0A) byte.
 *
 * None of these modes assumes a specific protocol; they only affect how
 * data is displayed. The bytes themselves are never modified.
 */
export type FramingMode = 'none' | 'idle' | 'lf';

export const FRAMING_MODES: readonly FramingMode[] = ['none', 'idle', 'lf'];

export interface FramingOptions {
  mode: FramingMode;
  /** Quiet time after which pending bytes are emitted. */
  idleMs: number;
  /** Hard limit for a single frame. */
  maxFrameBytes?: number;
}

export const MIN_IDLE_MS = 1;
export const MAX_IDLE_MS = 10_000;
export const DEFAULT_MAX_FRAME_BYTES = 1024;

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class RxFramer {
  private pending: Uint8Array = new Uint8Array(0);
  private timer: unknown = undefined;

  constructor(
    private options: FramingOptions,
    private readonly onFrame: (bytes: Uint8Array) => void,
    private readonly timers: TimerApi = defaultTimers,
  ) {}

  setOptions(options: FramingOptions): void {
    this.flush();
    this.options = options;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    if (this.options.mode === 'none') {
      this.emitLimited(chunk);
      return;
    }

    this.pending = this.pending.length ? concatBytes(this.pending, chunk) : chunk.slice();

    if (this.options.mode === 'lf') {
      let lf = this.pending.indexOf(0x0a);
      while (lf !== -1) {
        this.emitLimited(this.pending.subarray(0, lf + 1));
        this.pending = this.pending.slice(lf + 1);
        lf = this.pending.indexOf(0x0a);
      }
    }

    const max = this.maxBytes();
    while (this.pending.length >= max) {
      const cut = utf8SafeSplitIndex(this.pending, max);
      this.onFrame(this.pending.slice(0, cut));
      this.pending = this.pending.slice(cut);
    }

    this.restartTimer();
  }

  /** Emits whatever is pending immediately. */
  flush(): void {
    this.cancelTimer();
    if (this.pending.length > 0) {
      const out = this.pending;
      this.pending = new Uint8Array(0);
      this.onFrame(out);
    }
  }

  /** Drops pending data and timers. */
  dispose(): void {
    this.cancelTimer();
    this.pending = new Uint8Array(0);
  }

  get pendingBytes(): number {
    return this.pending.length;
  }

  private maxBytes(): number {
    return Math.max(1, this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
  }

  private emitLimited(bytes: Uint8Array): void {
    const max = this.maxBytes();
    let rest = bytes;
    while (rest.length > max) {
      const cut = utf8SafeSplitIndex(rest, max);
      this.onFrame(rest.slice(0, cut));
      rest = rest.subarray(cut);
    }
    if (rest.length > 0) this.onFrame(rest.slice());
  }

  private restartTimer(): void {
    this.cancelTimer();
    if (this.pending.length === 0) return;
    const ms = Math.min(MAX_IDLE_MS, Math.max(MIN_IDLE_MS, this.options.idleMs));
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
