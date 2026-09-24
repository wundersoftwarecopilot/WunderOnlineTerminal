/**
 * Encoding / decoding helpers for raw bytes.
 *
 * Everything in this module is pure and transport-agnostic: it only deals
 * with Uint8Array <-> string conversions used by the terminal to display
 * received data and to build data to transmit.
 */

const HEX_DIGITS = '0123456789ABCDEF';

/** Formats bytes as upper-case hex pairs, e.g. `50 32 31 0D 0A`. */
export function bytesToHex(bytes: Uint8Array, separator = ' '): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (i > 0) out += separator;
    out += HEX_DIGITS[b >> 4]! + HEX_DIGITS[b & 0x0f]!;
  }
  return out;
}

export type HexParseError =
  | { code: 'empty' }
  | { code: 'invalidChar'; char: string; position: number }
  | { code: 'oddDigits'; token: string };

export type ParseResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: HexParseError };

const HEX_SEPARATORS = /[\s,;:\-]/;

function isHexDigit(ch: string): boolean {
  return /^[0-9a-fA-F]$/.test(ch);
}

/**
 * Parses a user-typed hex string.
 *
 * Accepted forms (can be mixed):
 * - `48 45 4C 4C 4F 0D 0A`
 * - `48454C4C4F0D0A`
 * - `0x48, 0x45, 0x4c`
 * - `48:45:4C` / `48-45-4C`
 *
 * Each token (separated by whitespace , ; : -) must contain an even number
 * of hex digits. A single digit is only accepted with an explicit `0x`
 * prefix (`0xA` -> 0x0A), so that input is never silently misread.
 */
export function parseHex(input: string): ParseResult {
  const bytes: number[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (HEX_SEPARATORS.test(ch)) {
      i++;
      continue;
    }

    // Start of a token.
    let hasPrefix = false;
    if (ch === '0' && (input[i + 1] === 'x' || input[i + 1] === 'X')) {
      hasPrefix = true;
      i += 2;
    }
    const tokenStart = i;
    while (i < n && !HEX_SEPARATORS.test(input[i]!)) {
      const c = input[i]!;
      if (!isHexDigit(c)) {
        return { ok: false, error: { code: 'invalidChar', char: c, position: i } };
      }
      i++;
    }
    let digits = input.slice(tokenStart, i);
    if (digits.length === 0) {
      // A bare "0x" without digits.
      return {
        ok: false,
        error: { code: 'invalidChar', char: input[tokenStart - 1] ?? 'x', position: tokenStart - 1 },
      };
    }
    if (digits.length % 2 !== 0) {
      if (hasPrefix && digits.length === 1) {
        digits = '0' + digits;
      } else {
        return {
          ok: false,
          error: { code: 'oddDigits', token: (hasPrefix ? '0x' : '') + digits },
        };
      }
    }
    for (let j = 0; j < digits.length; j += 2) {
      bytes.push(parseInt(digits.slice(j, j + 2), 16));
    }
  }

  if (bytes.length === 0) return { ok: false, error: { code: 'empty' } };
  return { ok: true, bytes: Uint8Array.from(bytes) };
}

const encoder = new TextEncoder();

/** Encodes a JS string as UTF-8. */
export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * Converts text typed by the user into bytes, interpreting the usual
 * escape sequences:
 *
 * `\r` `\n` `\t` `\0` `\\` and `\xHH` (a raw byte, NOT a UTF-8 code point).
 *
 * Unknown escapes (e.g. `\q`) and a trailing lone backslash are kept
 * literally, so arbitrary text never fails to encode.
 */
export function encodeTextWithEscapes(text: string): Uint8Array {
  const parts: number[] = [];
  let literal = '';
  const flush = (): void => {
    if (literal) {
      for (const b of encoder.encode(literal)) parts.push(b);
      literal = '';
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '\\' || i === text.length - 1) {
      literal += ch;
      continue;
    }
    const next = text[i + 1]!;
    let byte: number | undefined;
    let consumed = 1;
    switch (next) {
      case 'r':
        byte = 0x0d;
        break;
      case 'n':
        byte = 0x0a;
        break;
      case 't':
        byte = 0x09;
        break;
      case '0':
        byte = 0x00;
        break;
      case '\\':
        byte = 0x5c;
        break;
      case 'x':
      case 'X': {
        const h = text.slice(i + 2, i + 4);
        if (h.length === 2 && isHexDigit(h[0]!) && isHexDigit(h[1]!)) {
          byte = parseInt(h, 16);
          consumed = 3;
        }
        break;
      }
      default:
        break;
    }
    if (byte === undefined) {
      literal += ch;
      continue;
    }
    flush();
    parts.push(byte);
    i += consumed;
  }
  flush();
  return Uint8Array.from(parts);
}

/** A piece of decoded data, ready to be displayed. */
export type DisplaySegment =
  | { kind: 'text'; value: string }
  /** A control character shown as an escape, e.g. `\r`. */
  | { kind: 'control'; value: string }
  /** A byte that is not part of a valid UTF-8 sequence, shown as `\xNN`. */
  | { kind: 'invalid'; value: string };

function hexByte(b: number): string {
  return HEX_DIGITS[b >> 4]! + HEX_DIGITS[b & 0x0f]!;
}

function controlEscape(codePoint: number): string {
  switch (codePoint) {
    case 0x00:
      return '\\0';
    case 0x09:
      return '\\t';
    case 0x0a:
      return '\\n';
    case 0x0d:
      return '\\r';
    default:
      // \xNN for ASCII controls; \uNNNN for decoded code points >= 0x80 so
      // they are never confused with invalid raw bytes (also shown as \xNN).
      return codePoint < 0x80
        ? '\\x' + hexByte(codePoint)
        : '\\u' + codePoint.toString(16).toUpperCase().padStart(4, '0');
  }
}

function isControl(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    codePoint === 0x7f ||
    (codePoint >= 0x80 && codePoint <= 0x9f) || // C1 controls
    codePoint === 0x2028 || // line separator
    codePoint === 0x2029 // paragraph separator
  );
}

/**
 * Length of a valid UTF-8 sequence starting at `i`, or 0 if the byte at
 * `i` does not start a valid, complete, well-formed sequence
 * (RFC 3629: no overlong forms, no surrogates, max U+10FFFF).
 */
function utf8SequenceLength(bytes: Uint8Array, i: number): number {
  const b0 = bytes[i]!;
  if (b0 < 0x80) return 1;
  const cont = (k: number, lo = 0x80, hi = 0xbf): boolean => {
    const b = bytes[i + k];
    return b !== undefined && b >= lo && b <= hi;
  };
  if (b0 >= 0xc2 && b0 <= 0xdf) return cont(1) ? 2 : 0;
  if (b0 === 0xe0) return cont(1, 0xa0, 0xbf) && cont(2) ? 3 : 0;
  if ((b0 >= 0xe1 && b0 <= 0xec) || b0 === 0xee || b0 === 0xef) return cont(1) && cont(2) ? 3 : 0;
  if (b0 === 0xed) return cont(1, 0x80, 0x9f) && cont(2) ? 3 : 0; // excludes surrogates
  if (b0 === 0xf0) return cont(1, 0x90, 0xbf) && cont(2) && cont(3) ? 4 : 0;
  if (b0 >= 0xf1 && b0 <= 0xf3) return cont(1) && cont(2) && cont(3) ? 4 : 0;
  if (b0 === 0xf4) return cont(1, 0x80, 0x8f) && cont(2) && cont(3) ? 4 : 0;
  return 0;
}

function decodeSequence(bytes: Uint8Array, i: number, len: number): number {
  const b0 = bytes[i]!;
  switch (len) {
    case 1:
      return b0;
    case 2:
      return ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
    case 3:
      return ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
    default:
      return (
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f)
      );
  }
}

/**
 * Decodes arbitrary bytes for display. Never throws.
 *
 * - valid UTF-8 text is returned as `text` segments;
 * - control characters become visible escapes (`\r`, `\n`, `\x1B`, ...);
 * - bytes that are not valid UTF-8 become `\xNN` so binary data is never
 *   hidden or silently replaced.
 */
export function decodeForDisplay(bytes: Uint8Array): DisplaySegment[] {
  const segments: DisplaySegment[] = [];
  const push = (kind: DisplaySegment['kind'], value: string): void => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.value += value;
    else segments.push({ kind, value });
  };

  let i = 0;
  while (i < bytes.length) {
    const len = utf8SequenceLength(bytes, i);
    if (len === 0) {
      push('invalid', '\\x' + hexByte(bytes[i]!));
      i++;
      continue;
    }
    const cp = decodeSequence(bytes, i, len);
    if (isControl(cp)) push('control', controlEscape(cp));
    else push('text', String.fromCodePoint(cp));
    i += len;
  }
  return segments;
}

/** Flattens display segments into a single printable string. */
export function segmentsToString(segments: readonly DisplaySegment[]): string {
  let out = '';
  for (const s of segments) out += s.value;
  return out;
}

/** Convenience: bytes -> printable string with escapes. */
export function bytesToDisplayText(bytes: Uint8Array): string {
  return segmentsToString(decodeForDisplay(bytes));
}

/**
 * Returns the largest index `<= limit` at which `bytes` can be split
 * without cutting a UTF-8 multi-byte sequence in half. Falls back to
 * `limit` for binary data that does not look like UTF-8.
 */
export function utf8SafeSplitIndex(bytes: Uint8Array, limit: number): number {
  if (limit >= bytes.length) return bytes.length;
  if (limit <= 0) return 0;
  // Walk back over at most 3 continuation bytes.
  let i = limit;
  let steps = 0;
  while (i > 0 && steps < 3 && (bytes[i]! & 0xc0) === 0x80) {
    i--;
    steps++;
  }
  if (i === limit) return limit; // not inside a sequence
  const len = utf8SequenceLength(bytes, i);
  // Only move the split if a valid sequence really straddles the limit.
  if (len > 0 && i + len > limit && i > 0) return i;
  return limit;
}

/** Concatenates byte arrays. */
export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Converts any BufferSource-like value (DataView, ArrayBuffer...) to a Uint8Array copy. */
export function toUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8Array(value.slice(0));
}
