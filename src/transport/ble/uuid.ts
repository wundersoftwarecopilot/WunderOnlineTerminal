/**
 * Bluetooth UUID helpers (no device-specific knowledge).
 *
 * 16- and 32-bit UUIDs are aliases of the Bluetooth SIG base UUID
 * `0000xxxx-0000-1000-8000-00805f9b34fb`.
 */

const BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Expands a 16/32-bit alias to the canonical 128-bit lower-case form. */
export function uuidFromAlias(alias: number): string {
  return (alias >>> 0).toString(16).padStart(8, '0') + BASE_SUFFIX;
}

/**
 * Normalizes a user-provided UUID. Accepts:
 * `180F`, `0x180F`, `0000180F` (32-bit), `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
 * and the same 128-bit value without dashes.
 * Returns `null` when the value is not a valid UUID.
 */
export function normalizeUuid(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  if (/^[0-9a-f]{4}$/.test(s) || /^[0-9a-f]{8}$/.test(s)) {
    return uuidFromAlias(parseInt(s, 16));
  }
  if (/^[0-9a-f]{32}$/.test(s)) {
    s = `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return FULL_UUID.test(s) ? s : null;
}

/** True when the UUID derives from the Bluetooth SIG base UUID. */
export function isSigUuid(uuid: string): boolean {
  const s = uuid.toLowerCase();
  return FULL_UUID.test(s) && s.endsWith(BASE_SUFFIX);
}

/** The 16-bit alias of a SIG UUID, or `undefined`. */
export function sigAlias(uuid: string): number | undefined {
  if (!isSigUuid(uuid)) return undefined;
  const value = parseInt(uuid.slice(0, 8), 16);
  return value <= 0xffff ? value : undefined;
}

/** Compact label: `0x180F` for SIG UUIDs, full UUID otherwise. */
export function formatUuid(uuid: string): string {
  const alias = sigAlias(uuid);
  if (alias !== undefined) return '0x' + alias.toString(16).toUpperCase().padStart(4, '0');
  return uuid.toLowerCase();
}

/** Very short label for terminal lines. */
export function shortUuid(uuid: string): string {
  const alias = sigAlias(uuid);
  if (alias !== undefined) return formatUuid(uuid);
  return uuid.toLowerCase().slice(0, 8);
}

/** Parses a free-form list of UUIDs separated by commas, spaces or new lines. */
export function parseUuidList(text: string): { uuids: string[]; invalid: string[] } {
  const uuids: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const uuid = normalizeUuid(token);
    if (uuid) {
      if (!uuids.includes(uuid)) uuids.push(uuid);
    } else {
      invalid.push(token);
    }
  }
  return { uuids, invalid };
}
