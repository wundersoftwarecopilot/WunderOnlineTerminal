import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RxFramer, type FramingOptions } from '../../src/core/framer';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function setup(options: FramingOptions) {
  const frames: string[] = [];
  const raw: Uint8Array[] = [];
  const framer = new RxFramer(options, (f) => {
    raw.push(f);
    frames.push(dec(f));
  });
  return { framer, frames, raw };
}

describe('RxFramer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mode none: emits every chunk immediately', () => {
    const { framer, frames } = setup({ mode: 'none', idleMs: 50 });
    framer.push(enc('P2'));
    framer.push(enc('1\r\n'));
    expect(frames).toEqual(['P2', '1\r\n']);
  });

  it('mode idle: merges chunks until the line is quiet', () => {
    const { framer, frames } = setup({ mode: 'idle', idleMs: 50 });
    framer.push(enc('P2'));
    vi.advanceTimersByTime(30);
    framer.push(enc('1\r\n'));
    vi.advanceTimersByTime(49);
    expect(frames).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(frames).toEqual(['P21\r\n']);
  });

  it('mode lf: splits after each LF and flushes the rest on idle', () => {
    const { framer, frames } = setup({ mode: 'lf', idleMs: 50 });
    framer.push(enc('A1\r\nB2\r\nC'));
    expect(frames).toEqual(['A1\r\n', 'B2\r\n']);
    framer.push(enc('3'));
    vi.advanceTimersByTime(50);
    expect(frames).toEqual(['A1\r\n', 'B2\r\n', 'C3']);
  });

  it('never modifies the bytes', () => {
    const { framer, raw } = setup({ mode: 'lf', idleMs: 10 });
    const input = Uint8Array.from([0x00, 0xff, 0x0a, 0x80, 0x0d]);
    framer.push(input);
    framer.flush();
    expect(Array.from(raw.flatMap((r) => Array.from(r)))).toEqual(Array.from(input));
  });

  it('caps frame length without cutting UTF-8 characters', () => {
    const { framer, frames } = setup({ mode: 'idle', idleMs: 50, maxFrameBytes: 4 });
    framer.push(enc('ab€cd')); // 61 62 E2 82 AC 63 64
    framer.flush();
    expect(frames).toEqual(['ab', '€c', 'd']);
  });

  it('caps frames in mode none too', () => {
    const { framer, raw } = setup({ mode: 'none', idleMs: 50, maxFrameBytes: 3 });
    framer.push(Uint8Array.from([1, 2, 3, 4, 5, 6, 7]));
    expect(raw.map((r) => r.length)).toEqual([3, 3, 1]);
  });

  it('flush, setOptions and dispose', () => {
    const { framer, frames } = setup({ mode: 'idle', idleMs: 50 });
    framer.push(enc('x'));
    expect(framer.pendingBytes).toBe(1);
    framer.setOptions({ mode: 'none', idleMs: 50 });
    expect(frames).toEqual(['x']);
    framer.push(enc('y'));
    expect(frames).toEqual(['x', 'y']);
    framer.setOptions({ mode: 'idle', idleMs: 50 });
    framer.push(enc('z'));
    framer.dispose();
    vi.advanceTimersByTime(100);
    expect(frames).toEqual(['x', 'y']);
  });
});
