# Online Terminal

**Online Terminal is a generic communication terminal for Bluetooth Low Energy (BLE) and
serial (COM) ports that runs entirely in the web browser.**

It is a general-purpose tool: it does not implement any device-specific protocol, handshake,
command set or data format. It discovers what the connected device exposes and lets you read,
write and watch raw bytes, as text or HEX.

- ✅ 100% client-side: a static single-page app, published on GitHub Pages
- ✅ No backend, no database, no server-side code, no cloud services
- ✅ Received data never leaves the browser: nothing is sent to any server
- ✅ No telemetry, no analytics, no cookies, no external fonts or scripts
- ✅ Available in Italiano, English, Español, Português, Français, Deutsch

---

## Contents

- [Features](#features)
- [Privacy and security](#privacy-and-security)
- [Browser requirements](#browser-requirements)
- [Limitations of Web Bluetooth and Web Serial](#limitations-of-web-bluetooth-and-web-serial)
- [Using the terminal](#using-the-terminal)
- [Development](#development)
- [Publishing on GitHub Pages](#publishing-on-github-pages)
- [Architecture](#architecture)
- [Header, logo and contacts](#header-logo-and-contacts)
- [In italiano](#in-italiano)

---

## Features

### Bluetooth Low Energy (Web Bluetooth API)

- Device selection through the browser's device picker (optional name-prefix filter)
- Connect / disconnect, device name and connection status
- **Dynamic discovery** of GATT services and characteristics at runtime
- Characteristic properties: Read, Write, Write Without Response, Notify, Indicate
- Read a characteristic, subscribe / unsubscribe to notifications and indications
- Write to any writable characteristic, with or without response, split into chunks
  of a configurable size (default 20 bytes)
- Optional automatic subscription to all notify/indicate characteristics after connecting
- Detection of lost connections

### Serial port (Web Serial API)

- Port selection through the browser's port picker
- Open / close the port, receive and transmit, detection of unplugged devices
- Line settings (defaults in **bold**):
  - Baud rate: 300 … 921600 (common values) or any custom value, default **9600**
  - Data bits: 7 / **8**
  - Stop bits: **1** / 2
  - Parity: **none** / even / odd
  - Flow control: **none** / hardware (RTS/CTS)
- Recoverable line errors (parity, framing, break, buffer overrun) are reported and reading continues

### Terminal

- RX / TX / INFO / ERROR lines with millisecond timestamps and the transport (BLE / SER)
- Display modes: **Text**, **HEX** and **HEX + Text** (e.g. `50 32 31 0D 0A    P21\r\n`)
- Binary-safe: control characters are shown as `\r`, `\n`, `\t`, `\x1B`…; bytes that are not
  valid UTF-8 are shown as `\xNN` (orange) instead of being hidden or replaced
- Correct UTF-8 decoding (multi-byte characters, emoji; overlong and surrogate sequences rejected)
- Optional RX grouping for display: as received / merge until idle / split lines on LF
- Auto-scroll on/off, Clear, RX/TX byte counters
- Export of the session log as **.txt** or **.csv**, generated locally in the browser

### Sending data

- **Text** (UTF-8) or **HEX** input (`48 45 4C 4C 4F`, `48454C4C4F`, `0x48,0x45`…)
- Optional escape sequences in text mode: `\r` `\n` `\t` `\0` `\\` `\xHH`
- Line ending: **None** (default), CR, LF, CR+LF — nothing is assumed about the device
- Live preview of the exact bytes, clear validation errors, history with ↑ / ↓

---

## Privacy and security

Online Terminal is designed so that communication data **cannot** leave the browser:

- **No network code.** The application never calls `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource`, `sendBeacon`, and loads no external script, font or stylesheet.
- **Enforced by the browser.** The production page ships a Content-Security-Policy with
  `connect-src 'none'` and `default-src 'none'`: even by mistake, the page is not allowed to open
  any network connection.
- **Verified automatically.** Unit tests scan the source code, the build script scans the
  generated bundle (`scripts/verify-build.mjs`), and an end-to-end test checks that a network
  request is blocked by the CSP and that no external request happens during use.
- **Nothing is saved automatically.** `localStorage` is used only for non-sensitive preferences:
  language, display options, send options and the last connection settings
  (baud rate, BLE options…). The communication log and the send history live only in memory and
  are lost when the page is closed, unless you export them yourself.
- **No credentials, keys or proprietary data** are contained in the project.
- Device data is always inserted into the page as text (never as HTML).
- The CSV export neutralizes spreadsheet formula injection (cells starting with `= + - @` are
  prefixed with `'`; the exact bytes are always available in the `hex` column).

The only external links are the publisher's contact links in the page header; they are ordinary
links that are opened only if the user clicks them.

---

## Browser requirements

Web Bluetooth and Web Serial are available only in Chromium-based browsers, on a secure
origin (**HTTPS** or `http://localhost`). GitHub Pages is served over HTTPS.

| Browser                                   | Web Bluetooth                         | Web Serial               |
| ----------------------------------------- | ------------------------------------- | ------------------------ |
| Chrome / Edge / Opera — Windows, macOS    | ✅                                     | ✅                        |
| Chrome — ChromeOS                         | ✅                                     | ✅                        |
| Chrome — Android                          | ✅                                     | ⚠️ limited / recent only  |
| Chrome — Linux                            | ⚠️ may require `chrome://flags/#enable-experimental-web-platform-features` | ✅ |
| Firefox (all platforms)                   | ❌                                     | ❌                        |
| Safari (macOS) and every browser on iOS   | ❌                                     | ❌                        |

When an API is not available the page still loads normally, and a clear, localized message
explains why the corresponding mode cannot be used (for example
*“Web Bluetooth is not supported by this browser.”*).

---

## Limitations of Web Bluetooth and Web Serial

These are limits of the browser APIs, not of the terminal:

**Web Bluetooth**

- **Only declared services are visible.** A page can access only the GATT services listed in
  `optionalServices` when the device is requested. Online Terminal always requests the complete
  Bluetooth SIG service range (`0x1800`–`0x18FF`) and, optionally, a few widely used public
  "BLE serial" profiles (Nordic UART, Microchip Transparent UART, u-blox SPS, `FFE0`, `FFF0`).
  For any other service, add its UUID in *Communication settings → Advanced settings →
  Additional service UUIDs* and reconnect.
- **Blocklist.** Browsers block some services and characteristics for security reasons
  (for example HID); operations on them fail with a permission error.
- The device must be chosen by the user in the browser picker (user gesture required); there is
  no background scanning and advertising data is not shown.
- The ATT MTU is not exposed: long writes are split into chunks (setting *Max bytes per write*).
- Connections are closed when the tab is closed; background tabs can be throttled by the browser.

**Web Serial**

- The port must be chosen by the user in the browser picker (user gesture required).
- A port can be opened by one application/tab at a time.
- Line settings are applied when the port is opened: change them and reconnect.
- Only the line settings supported by the API are available (7/8 data bits, 1/2 stop bits,
  none/even/odd parity, none/hardware flow control).

**Both:** inside an `<iframe>` the embedding page must allow the features through
Permissions-Policy.

---

## Using the terminal

1. Open the page in a supported browser.
2. Choose **BLE** or **SERIAL** (both can be connected at the same time).
3. Adjust the communication settings if needed, then click **Connect** and pick the device/port.
4. BLE: the services and characteristics are listed; use **Read**, **Subscribe** and
   **Send here** on each characteristic.
5. Type in the **Send** box, choose Text/HEX and the line ending, press **Enter** or **Send**.
6. Switch between **Text**, **HEX** and **HEX + Text**, **Clear** the terminal or
   **Export** the log.

The language follows the browser (`navigator.languages`); unsupported languages fall back to
English. A language chosen manually in the header takes priority and is remembered.

---

## Development

Requirements: Node.js 20+ (see `.nvmrc`) and npm.

```bash
npm ci                # install exact dependency versions from package-lock.json
npm run dev           # development server on http://localhost:5173
npm test              # unit + integration tests (Vitest), no hardware needed
npm run typecheck     # TypeScript checks (app, tests, e2e)
npm run build         # production build in dist/ + privacy/deployment checks
npm run preview       # serve dist/ on http://localhost:4173
npm run test:e2e      # end-to-end tests in Chromium against dist/ (run the build first)
npm run test:all      # tests + build + end-to-end tests
```

End-to-end tests need a Playwright Chromium (`npx playwright install chromium` once).

### Testing without hardware

BLE and serial devices are simulated:

- `tests/mocks/mockBluetooth.ts` — a generic in-memory GATT peripheral (services,
  characteristics, read/write/notify, disconnection, errors);
- `tests/mocks/mockSerial.ts` — a serial port built on Web Streams (RX, TX, line errors, unplug);
- `tests/mocks/mockTransport.ts` — a minimal transport to test the terminal on its own;
- `e2e/webApiMocks.ts` — the same idea injected into a real Chromium page.

The suites cover encoding/decoding, HEX parsing, escapes, line endings, RX grouping,
language detection and fallback, settings and defaults, export formats, both transports,
the full UI and the privacy guarantees.

---

## Publishing on GitHub Pages

The repository contains a ready-to-use workflow: `.github/workflows/pages.yml`.

1. Push the project to GitHub, on the `main` branch.
2. In the repository open **Settings → Pages** and set **Source: GitHub Actions**.
3. Every push to `main` runs type checks, unit tests, the production build (with the
   privacy checks) and the end-to-end tests, then deploys `dist/` to GitHub Pages.
   Pull requests are tested but not deployed. The workflow can also be started manually
   (*Actions → Test, build and deploy to GitHub Pages → Run workflow*).
4. The site is published at `https://<user>.github.io/<repository>/`
   (or on your custom domain, configurable in **Settings → Pages**).

The build is reproducible (`npm ci` with the committed `package-lock.json`, pinned dependency
versions, Node version from `.nvmrc`) and uses relative paths, so it works from any sub-path.
No Node server, API, database, Docker or cloud service is needed in production: `dist/` is a
set of static files that can also be hosted on any static web server over HTTPS.

---

## Architecture

```text
src/
├── main.ts / app.ts           composition root: creates services, mounts the UI
├── core/                      pure logic, no DOM, no browser APIs
│   ├── bytes.ts               HEX format/parse, UTF-8, escapes, binary-safe display decoding
│   ├── payload.ts             user input → bytes (text/HEX + line ending)
│   ├── lineEnding.ts          None / CR / LF / CRLF
│   ├── framer.ts              RX grouping for display (none / idle / LF)
│   └── emitter.ts             tiny typed event emitter
├── transport/                 the only code that touches devices
│   ├── types.ts               Transport interface (common contract)
│   ├── errors.ts              TransportError + DOMException mapping
│   ├── ble/BluetoothTransport.ts   Web Bluetooth implementation (dynamic GATT discovery)
│   ├── ble/knownUuids.ts      public SIG ranges / generic serial profiles / display names
│   ├── ble/uuid.ts            UUID helpers
│   └── serial/SerialTransport.ts   Web Serial implementation (+ serialConfig.ts)
├── terminal/                  transport-agnostic terminal
│   ├── log.ts                 in-memory log (bounded)
│   ├── session.ts             transport events → log; send → TX lines
│   └── format.ts              timestamps and line formatting
├── export/                    .txt / .csv generation and local download
├── i18n/                      detection, persistence, translations (6 locales)
├── settings/                  preferences (validated) + safe localStorage wrapper
├── ui/                        DOM components (no framework)
└── branding/                  publisher logo and contact links (presentational only)
```

```text
            ┌──────────────────────┐
            │  Transport interface │  connect() · disconnect() · send(bytes)
            └──────────┬───────────┘  events: state · data · error
          ┌────────────┴────────────┐
 ┌────────▼─────────┐     ┌─────────▼────────┐
 │BluetoothTransport│     │ SerialTransport  │
 └──────────────────┘     └──────────────────┘
                 ▲                 ▲
                 └──── TerminalSession ────► TerminalLog ────► UI / export
```

The terminal (`terminal/`) only knows the `Transport` interface: the same code logs and sends
data for BLE and serial. Architecture rules (no network APIs, no UI/branding dependencies in the
core, only public UUIDs, storage limited to preferences) are enforced by
`tests/unit/privacy.test.ts`.

---

## Header, logo and contacts

The header shows the publisher's logo (linking to the publisher's website) and contact links.
This is purely presentational and completely separate from the terminal:

- contacts and links: `src/branding/brand.ts`
- logo image: `public/brand/logo.svg` (replace the file to change the logo)

---

## In italiano

**Online Terminal** è un terminale di comunicazione **generico** per Bluetooth Low Energy e
porte seriali (COM) che funziona **interamente nel browser**: nessun backend, nessun database,
nessuna telemetria. I dati ricevuti dai dispositivi **non vengono mai inviati a server**: la
pagina è protetta da una Content-Security-Policy che vieta qualsiasi connessione di rete
(`connect-src 'none'`). Nel `localStorage` vengono salvate solo preferenze non sensibili
(lingua, opzioni di visualizzazione, ultime impostazioni); il log resta in memoria e può essere
esportato in `.txt` o `.csv` solo su richiesta.

- **BLE** (Web Bluetooth): scelta del dispositivo, discovery dinamico di servizi e characteristic,
  proprietà Read/Write/Write Without Response/Notify/Indicate, lettura, notifiche, scrittura.
- **Seriale** (Web Serial): apertura/chiusura porta, RX/TX, baud rate configurabile,
  predefinito **9600 8N1**, nessun controllo di flusso.
- **Terminale**: RX/TX con timestamp, visualizzazione Testo / HEX / HEX + Testo, invio in
  testo o HEX, fine riga None/CR/LF/CRLF, auto-scroll, pulizia, esportazione.
- **Requisiti**: Chrome, Edge o Opera su HTTPS (GitHub Pages è in HTTPS). Firefox e Safari non
  supportano queste API: la pagina lo segnala con un messaggio localizzato.
- **Pubblicazione**: *Settings → Pages → Source: GitHub Actions*, poi push su `main`.
