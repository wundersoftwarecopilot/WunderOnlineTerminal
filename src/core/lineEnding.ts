/** Optional line terminator appended to transmitted data. */
export type LineEnding = 'none' | 'cr' | 'lf' | 'crlf';

export const LINE_ENDINGS: readonly LineEnding[] = ['none', 'cr', 'lf', 'crlf'];

const BYTES: Record<LineEnding, readonly number[]> = {
  none: [],
  cr: [0x0d],
  lf: [0x0a],
  crlf: [0x0d, 0x0a],
};

export function lineEndingBytes(ending: LineEnding): Uint8Array {
  return Uint8Array.from(BYTES[ending]);
}

export function isLineEnding(value: unknown): value is LineEnding {
  return typeof value === 'string' && (LINE_ENDINGS as readonly string[]).includes(value);
}
