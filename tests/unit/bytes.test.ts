import { describe, expect, it } from 'vitest';
import {
  bytesToDisplayText,
  bytesToHex,
  concatBytes,
  decodeForDisplay,
  encodeTextWithEscapes,
  parseHex,
  toUint8Array,
  utf8Encode,
  utf8SafeSplitIndex,
} from '../../src/core/bytes';

const b = (...n: number[]) => Uint8Array.from(n);

describe('bytesToHex', () => {
  it('formats upper-case pairs separated by spaces', () => {
    expect(bytesToHex(b(0x50, 0x32, 0x31, 0x0d, 0x0a))).toBe('50 32 31 0D 0A');
  });
  it('handles empty input and custom separators', () => {
    expect(bytesToHex(b())).toBe('');
    expect(bytesToHex(b(0, 255, 16), ':')).toBe('00:FF:10');
  });
});

describe('parseHex', () => {
  const ok = (s: string) => {
    const r = parseHex(s);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return Array.from(r.bytes);
  };

  it('parses the documented example', () => {
    expect(ok('48 45 4C 4C 4F 0D 0A')).toEqual([0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0d, 0x0a]);
  });
  it('accepts compact, lower-case, 0x-prefixed and separated forms', () => {
    expect(ok('48454c4c4f')).toEqual([0x48, 0x45, 0x4c, 0x4c, 0x4f]);
    expect(ok('0x48, 0x45,0x4C')).toEqual([0x48, 0x45, 0x4c]);
    expect(ok('48:45-4C;4F\n0D\t0A')).toEqual([0x48, 0x45, 0x4c, 0x4f, 0x0d, 0x0a]);
    expect(ok('0xA 0x0b')).toEqual([0x0a, 0x0b]);
  });
  it('rejects invalid characters with their position', () => {
    expect(parseHex('48 4G')).toEqual({ ok: false, error: { code: 'invalidChar', char: 'G', position: 4 } });
    expect(parseHex('0x')).toMatchObject({ ok: false, error: { code: 'invalidChar' } });
  });
  it('rejects tokens with an odd number of digits', () => {
    expect(parseHex('48 4')).toEqual({ ok: false, error: { code: 'oddDigits', token: '4' } });
    expect(parseHex('ABC')).toEqual({ ok: false, error: { code: 'oddDigits', token: 'ABC' } });
  });
  it('reports empty input', () => {
    expect(parseHex('   ')).toEqual({ ok: false, error: { code: 'empty' } });
  });
});

describe('encodeTextWithEscapes', () => {
  it('interprets \\r \\n \\t \\0 \\\\ and \\xHH', () => {
    expect(Array.from(encodeTextWithEscapes('HELLO\\r\\n'))).toEqual([
      0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0d, 0x0a,
    ]);
    expect(Array.from(encodeTextWithEscapes('a\\tb\\0\\\\'))).toEqual([0x61, 0x09, 0x62, 0x00, 0x5c]);
  });
  it('\\xHH produces a raw byte, not a UTF-8 code point', () => {
    expect(Array.from(encodeTextWithEscapes('\\xFF\\x00'))).toEqual([0xff, 0x00]);
  });
  it('keeps unknown escapes and a trailing backslash literally', () => {
    expect(new TextDecoder().decode(encodeTextWithEscapes('C:\\q\\'))).toBe('C:\\q\\');
    expect(new TextDecoder().decode(encodeTextWithEscapes('\\xZZ'))).toBe('\\xZZ');
  });
  it('encodes non-ASCII text as UTF-8', () => {
    expect(Array.from(encodeTextWithEscapes('€'))).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8Encode('è')).toEqual(b(0xc3, 0xa8));
  });
});

describe('decodeForDisplay', () => {
  it('shows printable text and escapes control characters', () => {
    expect(decodeForDisplay(utf8Encode('P21\r\n'))).toEqual([
      { kind: 'text', value: 'P21' },
      { kind: 'control', value: '\\r\\n' },
    ]);
    expect(bytesToDisplayText(b(0x1b, 0x5b, 0x09, 0x00, 0x7f))).toBe('\\x1B[\\t\\0\\x7F');
  });
  it('decodes valid multi-byte UTF-8', () => {
    expect(bytesToDisplayText(utf8Encode('Già 25 °C € 😀'))).toBe('Già 25 °C € 😀');
  });
  it('shows invalid bytes as \\xNN instead of hiding them', () => {
    expect(decodeForDisplay(b(0x41, 0xff, 0x42))).toEqual([
      { kind: 'text', value: 'A' },
      { kind: 'invalid', value: '\\xFF' },
      { kind: 'text', value: 'B' },
    ]);
  });
  it('rejects overlong encodings, surrogates and truncated sequences', () => {
    expect(bytesToDisplayText(b(0xc0, 0xaf))).toBe('\\xC0\\xAF'); // overlong '/'
    expect(bytesToDisplayText(b(0xed, 0xa0, 0x80))).toBe('\\xED\\xA0\\x80'); // surrogate
    expect(bytesToDisplayText(b(0xe2, 0x82))).toBe('\\xE2\\x82'); // truncated €
    expect(bytesToDisplayText(b(0xf4, 0x90, 0x80, 0x80))).toBe('\\xF4\\x90\\x80\\x80'); // > U+10FFFF
  });
  it('escapes C1 controls and line separators', () => {
    expect(bytesToDisplayText(b(0xc2, 0x85))).toBe('\\u0085');
    expect(bytesToDisplayText(utf8Encode('\u2028'))).toBe('\\u2028');
  });
  it('never throws on random binary data', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    for (let i = 0; i < 300; i++) {
      const data = Uint8Array.from({ length: (i % 40) + 1 }, rnd);
      expect(() => decodeForDisplay(data)).not.toThrow();
      expect(typeof bytesToDisplayText(data)).toBe('string');
    }
  });
});

describe('utf8SafeSplitIndex', () => {
  it('does not cut a multi-byte character', () => {
    const data = utf8Encode('ab€'); // 61 62 E2 82 AC
    expect(utf8SafeSplitIndex(data, 3)).toBe(2);
    expect(utf8SafeSplitIndex(data, 4)).toBe(2);
    expect(utf8SafeSplitIndex(data, 2)).toBe(2);
    expect(utf8SafeSplitIndex(data, 10)).toBe(5);
  });
  it('falls back to the limit for binary data', () => {
    expect(utf8SafeSplitIndex(b(0x80, 0x80, 0x80, 0x80, 0x80), 3)).toBe(3);
  });
});

describe('helpers', () => {
  it('concatenates and converts buffers', () => {
    expect(concatBytes(b(1), b(), b(2, 3))).toEqual(b(1, 2, 3));
    const buf = b(9, 8, 7, 6).buffer;
    expect(toUint8Array(new DataView(buf, 1, 2))).toEqual(b(8, 7));
    expect(toUint8Array(buf)).toEqual(b(9, 8, 7, 6));
  });
});
