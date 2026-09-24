/**
 * Static guarantees on the source code:
 * - no network API is used anywhere (data cannot leave the browser);
 * - only non-sensitive preferences go to localStorage;
 * - only public, vendor-neutral Bluetooth UUIDs are embedded;
 * - the terminal core does not depend on transport implementations or on
 *   the publisher branding.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const sources = files(SRC)
  .filter((f) => /\.(ts|css|html)$/.test(f))
  .map((f) => ({ path: relative(SRC, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));

/** Source without comments (so documentation can mention forbidden APIs). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('privacy: no network access', () => {
  const forbidden: Array<[RegExp, string]> = [
    [/\bfetch\s*\(/, 'fetch'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\bEventSource\b/, 'EventSource'],
    [/\bsendBeacon\b/, 'sendBeacon'],
    [/\bRTCPeerConnection\b/, 'RTCPeerConnection'],
    [/\bimportScripts\b/, 'importScripts'],
    [/\bimport\s*\(\s*['"]https?:/, 'remote import'],
    [/@import\s+url\(\s*['"]?https?:/, 'remote CSS import'],
  ];

  it('the source tree was found', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  for (const [re, name] of forbidden) {
    it(`does not use ${name}`, () => {
      const offenders = sources.filter((s) => re.test(code(s.text))).map((s) => s.path);
      expect(offenders).toEqual([]);
    });
  }

  it('contains only allowlisted absolute URLs (publisher links, SVG namespace)', () => {
    const allowed = [
      'http://www.w3.org/2000/svg',
      'https://www.wunder.it',
      'https://www.facebook.com/WunderSaBisrl/',
      'https://www.linkedin.com/company/wunder-sa.bi.-s.r.l./',
      'https://feathericons.com', // licence attribution in a comment
    ];
    const urls = sources.flatMap((s) =>
      [...s.text.matchAll(/\bhttps?:\/\/[^\s"'`)<>]+/g)].map((m) => `${s.path}: ${m[0]}`),
    );
    const bad = urls.filter((u) => !allowed.some((a) => u.split(': ')[1]!.startsWith(a)));
    expect(bad).toEqual([]);
  });

  it('publisher links live only in the branding module', () => {
    const offenders = sources
      .filter((s) => !s.path.startsWith('branding/'))
      .filter((s) => /wunder\.it|facebook\.com|linkedin\.com/i.test(s.text))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });
});

describe('privacy: storage', () => {
  it('localStorage is accessed only by the storage wrapper', () => {
    const offenders = sources
      .filter((s) => /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie/.test(code(s.text)))
      .map((s) => s.path);
    expect(offenders).toEqual(['settings/storage.ts']);
  });

  it('only the language and the settings are written', () => {
    const writers = sources
      .filter((s) => /storage\.set\(/.test(code(s.text)))
      .map((s) => [s.path, [...code(s.text).matchAll(/storage\.set\(\s*([^,]+),/g)].map((m) => m[1]!.trim())]);
    expect(writers).toEqual([
      ['i18n/i18n.ts', ['STORAGE_KEYS.language']],
      ['settings/settings.ts', ['STORAGE_KEYS.settings']],
    ]);
  });
});

describe('genericity: no proprietary protocol data', () => {
  const PUBLIC_128_BIT_UUIDS = new Set([
    // Nordic UART Service (Nordic Semiconductor, public documentation)
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    // Microchip Transparent UART (public documentation)
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '49535343-8841-43f4-a8d4-ecbe34729bb3',
    '49535343-1e4d-4bd9-ba61-23c647249616',
    // u-blox Serial Port Service (public documentation)
    '2456e1b9-26e2-8f83-e744-f34f01e9d701',
    '2456e1b9-26e2-8f83-e744-f34f01e9d703',
    '2456e1b9-26e2-8f83-e744-f34f01e9d704',
  ]);
  const SIG_BASE = /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/;

  it('every 128-bit UUID is a Bluetooth SIG alias or a public generic profile', () => {
    const found = sources.flatMap((s) =>
      [...s.text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => ({
        path: s.path,
        uuid: m[0].toLowerCase(),
      })),
    );
    const unknown = found.filter((f) => !SIG_BASE.test(f.uuid) && !PUBLIC_128_BIT_UUIDS.has(f.uuid));
    expect(unknown).toEqual([]);
  });

  it('never writes to a device on its own (writes only happen in send())', () => {
    const ble = sources.find((s) => s.path === 'transport/ble/BluetoothTransport.ts')!;
    const writeCalls = [...code(ble.text).matchAll(/\bwrite(?:Value\w*)?\.call\(|\.writeValue\w*\(/g)];
    expect(writeCalls).toHaveLength(1); // the single write inside send()
  });
});

describe('architecture', () => {
  const importsOf = (path: string) =>
    [...sources.find((s) => s.path === path)!.text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

  it('the terminal does not know transport implementations', () => {
    for (const s of sources.filter((x) => x.path.startsWith('terminal/'))) {
      const bad = importsOf(s.path).filter((i) => /transport\/(ble|serial)\//.test(i));
      expect(bad, s.path).toEqual([]);
    }
  });

  it('core, terminal, transports and export do not depend on UI or branding', () => {
    for (const s of sources.filter((x) => /^(core|terminal|transport|export)\//.test(x.path))) {
      const bad = importsOf(s.path).filter((i) => /\/(ui|branding)\//.test(i));
      expect(bad, s.path).toEqual([]);
    }
  });
});
