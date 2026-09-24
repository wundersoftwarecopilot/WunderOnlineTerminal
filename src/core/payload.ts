import { concatBytes, encodeTextWithEscapes, parseHex, utf8Encode, type HexParseError } from './bytes';
import { lineEndingBytes, type LineEnding } from './lineEnding';

/** How the user input in the "Send" box is interpreted. */
export type InputMode = 'text' | 'hex';

export interface PayloadOptions {
  mode: InputMode;
  lineEnding: LineEnding;
  /** Interpret `\r`, `\n`, `\xHH`, ... in text mode. */
  escapes: boolean;
}

export type PayloadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: HexParseError };

/**
 * Builds the bytes to transmit from what the user typed.
 * Pure function: no knowledge of any device or transport.
 */
export function buildPayload(input: string, options: PayloadOptions): PayloadResult {
  let body: Uint8Array;
  if (options.mode === 'hex') {
    if (input.trim() === '') {
      body = new Uint8Array(0);
    } else {
      const parsed = parseHex(input);
      if (!parsed.ok) return parsed;
      body = parsed.bytes;
    }
  } else {
    body = options.escapes ? encodeTextWithEscapes(input) : utf8Encode(input);
  }
  const bytes = concatBytes(body, lineEndingBytes(options.lineEnding));
  if (bytes.length === 0) return { ok: false, error: { code: 'empty' } };
  return { ok: true, bytes };
}
