/**
 * Safe wrapper around `localStorage`.
 *
 * Only small, non-sensitive preferences are stored (language, UI and
 * terminal settings). Communication data is NEVER written to storage.
 * Every access is guarded: storage may be disabled, full or unavailable
 * (private mode, sandboxed iframes...), and the app must keep working.
 */
export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const STORAGE_PREFIX = 'online-terminal:';

export const STORAGE_KEYS = {
  language: `${STORAGE_PREFIX}language`,
  settings: `${STORAGE_PREFIX}settings`,
} as const;

export function createBrowserStorage(): KeyValueStorage {
  const ls = (): Storage | undefined => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    get(key) {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        ls()?.setItem(key, value);
      } catch {
        /* quota exceeded or storage disabled: ignore */
      }
    },
    remove(key) {
      try {
        ls()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** In-memory storage, used by tests and as a fallback. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}
