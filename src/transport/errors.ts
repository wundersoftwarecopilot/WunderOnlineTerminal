/** Transport-agnostic error codes (each one has a localized message). */
export type TransportErrorCode =
  | 'notSupported'
  | 'insecureContext'
  | 'cancelled'
  | 'permissionDenied'
  | 'notConnected'
  | 'busy'
  | 'connectionFailed'
  | 'connectionLost'
  | 'operationNotSupported'
  | 'noWritableChannel'
  | 'writeFailed'
  | 'readFailed'
  | 'subscribeFailed'
  | 'openFailed'
  | 'adapterUnavailable'
  | 'receiveError'
  | 'unknown';

export class TransportError extends Error {
  override readonly name = 'TransportError';

  constructor(
    readonly code: TransportErrorCode,
    /** Raw technical detail from the browser, shown for diagnostics. */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

function errorName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    return typeof msg === 'string' && msg ? msg : undefined;
  }
  if (typeof err === 'string') return err;
  return undefined;
}

/**
 * Maps a DOMException (or anything thrown) from Web Bluetooth / Web Serial
 * to a TransportError. `fallback` is used for errors that carry no more
 * specific meaning.
 */
export function toTransportError(
  err: unknown,
  fallback: TransportErrorCode,
  context: 'request' | 'operation' = 'operation',
): TransportError {
  if (err instanceof TransportError) return err;
  const name = errorName(err);
  const detail = errorMessage(err);
  switch (name) {
    case 'NotFoundError':
      // For requestDevice()/requestPort() this means the chooser was closed
      // without selecting anything.
      return new TransportError(context === 'request' ? 'cancelled' : fallback, detail);
    case 'AbortError':
      return new TransportError(context === 'request' ? 'cancelled' : fallback, detail);
    case 'SecurityError':
    case 'NotAllowedError':
      return new TransportError('permissionDenied', detail);
    case 'NotSupportedError':
      return new TransportError('operationNotSupported', detail);
    case 'InvalidStateError':
      return new TransportError(context === 'request' ? 'busy' : fallback, detail);
    case 'NetworkError':
      return new TransportError(fallback === 'openFailed' ? 'openFailed' : fallback, detail);
    default:
      return new TransportError(fallback, detail);
  }
}
