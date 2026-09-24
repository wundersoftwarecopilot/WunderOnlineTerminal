#!/usr/bin/env node
/**
 * Post-build privacy & deployment checks for the static site in dist/.
 *
 * 1. index.html carries a Content-Security-Policy with connect-src 'none'
 *    (the page cannot open any network connection).
 * 2. Asset URLs are relative (works on any GitHub Pages sub-path).
 * 3. The bundle contains no network API usage (fetch, XHR, WebSocket,
 *    EventSource, sendBeacon, importScripts).
 * 4. Every absolute URL in the output is in an explicit allowlist
 *    (publisher links in the header + the SVG XML namespace).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const errors = [];
const fail = (msg) => errors.push(msg);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html not found. Run the build first.');
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
if (!csp) fail('index.html: Content-Security-Policy meta tag missing');
else {
  if (!/connect-src 'none'/.test(csp[1])) fail("CSP: connect-src 'none' missing");
  if (!/default-src 'none'/.test(csp[1])) fail("CSP: default-src 'none' missing");
  if (/unsafe-inline|unsafe-eval/.test(csp[1])) fail('CSP: unsafe-* source found');
}
if (/(?:src|href)="\/(?!\/)/.test(html)) fail('index.html: absolute asset path found (use relative base)');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) fail('index.html: inline <script> found');

const FORBIDDEN_APIS = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\bimportScripts\b/, 'importScripts'],
  [/\bRTCPeerConnection\b/, 'RTCPeerConnection'],
];

const ALLOWED_URL_PREFIXES = [
  'http://www.w3.org/2000/svg', // XML namespace, not a request
  'https://www.wunder.it',
  'https://www.facebook.com/WunderSaBisrl/',
  'https://www.linkedin.com/company/wunder-sa.bi.-s.r.l./',
];

const TEXT_EXT = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt', '.webmanifest']);
const files = walk(DIST);
let jsCount = 0;
for (const file of files) {
  const ext = extname(file);
  if (!TEXT_EXT.has(ext)) continue;
  const rel = relative(DIST, file);
  const content = readFileSync(file, 'utf8');
  if (ext === '.js') {
    jsCount++;
    for (const [re, name] of FORBIDDEN_APIS) {
      if (re.test(content)) fail(`${rel}: forbidden network API ${name}`);
    }
  }
  for (const m of content.matchAll(/\bhttps?:\/\/[^\s"'`)<>\\]+/g)) {
    const url = m[0];
    if (!ALLOWED_URL_PREFIXES.some((p) => url.startsWith(p))) {
      fail(`${rel}: URL not in allowlist: ${url}`);
    }
  }
}
if (jsCount === 0) fail('no JavaScript bundle found');

for (const required of ['favicon.svg', 'brand/logo.svg', '.nojekyll']) {
  if (!existsSync(join(DIST, required))) fail(`missing ${required}`);
}

if (errors.length) {
  console.error('\n✖ Build verification failed:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✔ Build verified: ${files.length} files, CSP connect-src 'none', no network APIs, relative paths.`);
