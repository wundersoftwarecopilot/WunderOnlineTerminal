import { describe, expect, it } from 'vitest';
import { isLineEnding, lineEndingBytes } from '../../src/core/lineEnding';
import { buildPayload, type PayloadOptions } from '../../src/core/payload';

const opts = (o: Partial<PayloadOptions> = {}): PayloadOptions => ({
  mode: 'text',
  lineEnding: 'none',
  escapes: true,
  ...o,
});

const bytes = (input: string, o: Partial<PayloadOptions> = {}) => {
  const r = buildPayload(input, opts(o));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return Array.from(r.bytes);
};

describe('line endings', () => {
  it('maps None / CR / LF / CRLF', () => {
    expect(Array.from(lineEndingBytes('none'))).toEqual([]);
    expect(Array.from(lineEndingBytes('cr'))).toEqual([0x0d]);
    expect(Array.from(lineEndingBytes('lf'))).toEqual([0x0a]);
    expect(Array.from(lineEndingBytes('crlf'))).toEqual([0x0d, 0x0a]);
    expect(isLineEnding('crlf')).toBe(true);
    expect(isLineEnding('CRLF')).toBe(false);
  });
});

describe('buildPayload', () => {
  it('sends text as UTF-8 with no terminator by default', () => {
    expect(bytes('HELLO')).toEqual([0x48, 0x45, 0x4c, 0x4c, 0x4f]);
  });
  it('appends the selected line ending (text mode)', () => {
    expect(bytes('A', { lineEnding: 'cr' })).toEqual([0x41, 0x0d]);
    expect(bytes('A', { lineEnding: 'lf' })).toEqual([0x41, 0x0a]);
    expect(bytes('A', { lineEnding: 'crlf' })).toEqual([0x41, 0x0d, 0x0a]);
  });
  it('matches the TEXT and HEX examples of the specification', () => {
    const fromText = bytes('HELLO\\r\\n');
    const fromHex = bytes('48 45 4C 4C 4F 0D 0A', { mode: 'hex' });
    expect(fromText).toEqual(fromHex);
  });
  it('can send escapes literally when disabled', () => {
    expect(bytes('\\n', { escapes: false })).toEqual([0x5c, 0x6e]);
  });
  it('appends the line ending in HEX mode too', () => {
    expect(bytes('01 02', { mode: 'hex', lineEnding: 'crlf' })).toEqual([1, 2, 0x0d, 0x0a]);
  });
  it('allows sending only a line ending', () => {
    expect(bytes('', { lineEnding: 'crlf' })).toEqual([0x0d, 0x0a]);
    expect(bytes('', { mode: 'hex', lineEnding: 'lf' })).toEqual([0x0a]);
  });
  it('reports errors', () => {
    expect(buildPayload('', opts())).toEqual({ ok: false, error: { code: 'empty' } });
    expect(buildPayload('4', opts({ mode: 'hex' }))).toMatchObject({
      ok: false,
      error: { code: 'oddDigits' },
    });
    expect(buildPayload('zz', opts({ mode: 'hex' }))).toMatchObject({
      ok: false,
      error: { code: 'invalidChar', char: 'z' },
    });
  });
});
