// @vitest-environment happy-dom
/**
 * UI integration tests: the real application mounted in a simulated DOM,
 * driven with the Web Bluetooth / Web Serial mocks (no hardware needed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContext, mountApp, type AppOptions } from '../../src/app';
import { STORAGE_KEYS, createMemoryStorage } from '../../src/settings/storage';
import { MockBluetooth, TEST_UUIDS, createTestPeripheral } from '../mocks/mockBluetooth';
import { MockSerial, MockSerialPort } from '../mocks/mockSerial';

async function waitFor(check: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function mount(options: AppOptions = {}) {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const storage = createMemoryStorage();
  const ctx = createContext({ storage, isSecureContext: () => true, ...options });
  mountApp(root, ctx);
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T & Element>(sel)!;
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const rows = () => $$('[data-testid="terminal"] .row');
  const click = (sel: string) => $<HTMLElement>(sel).click();
  return { root, ctx, storage, $, $$, rows, click };
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, event = 'change') {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UI: languages', () => {
  it('uses the browser language and translates the page', () => {
    const { $, root } = mount({ languages: ['it-IT'], bluetooth: () => undefined, serial: () => undefined });
    expect(document.documentElement.lang).toBe('it');
    expect($('.app-title').textContent).toBe('Online Terminal');
    expect($('#tab-serial').textContent).toContain('Seriale');
    expect(root.textContent).toContain('Impostazioni di comunicazione');
  });

  it('falls back to English', () => {
    const { $ } = mount({ languages: ['ja-JP'], bluetooth: () => undefined, serial: () => undefined });
    expect(document.documentElement.lang).toBe('en');
    expect($('[data-testid="connect"]').textContent).toBe('Connect');
  });

  it('manual selection re-translates everything and is persisted', () => {
    const { $, storage, root } = mount({ languages: ['it-IT'], bluetooth: () => undefined, serial: () => undefined });
    setValue($<HTMLSelectElement>('.lang-select'), 'de');
    expect(document.documentElement.lang).toBe('de');
    expect($('[data-testid="connect"]').textContent).toBe('Verbinden');
    expect(root.textContent).toContain('Web Bluetooth wird von diesem Browser nicht unterstützt.');
    expect(storage.get(STORAGE_KEYS.language)).toBe('de');
  });
});

describe('UI: unsupported browsers', () => {
  it('shows a localized message and disables Connect, without breaking the page', () => {
    const { $, click, ctx } = mount({ languages: ['en'], bluetooth: () => undefined, serial: () => undefined });
    expect($('[data-testid="support-message"]').textContent).toBe(
      'Web Bluetooth is not supported by this browser.',
    );
    expect($<HTMLButtonElement>('[data-testid="connect"]').disabled).toBe(true);
    click('#tab-serial');
    expect(ctx.settings.value.mode).toBe('serial');
    expect($('[data-testid="support-message"]').textContent).toBe(
      'Web Serial is not supported by this browser.',
    );
    // The rest of the UI keeps working.
    click('[data-testid="view-mode"] [data-value="hex"]');
    expect(ctx.settings.value.view).toBe('hex');
  });
});

describe('UI: BLE workflow', () => {
  it('connects, discovers, reads, subscribes, writes', async () => {
    const device = createTestPeripheral('Demo Sensor');
    const bluetooth = new MockBluetooth(device);
    const { $, $$, rows, click, ctx } = mount({ languages: ['en'], bluetooth, serial: () => undefined });
    ctx.settings.update({ ble: { autoSubscribe: false } });

    click('[data-testid="connect"]');
    await waitFor(() => ctx.ble.state === 'connected');
    expect($('[data-testid="connection-status"]').textContent).toBe('Connected');
    expect($('[data-testid="device-name"]').textContent).toBe('Demo Sensor');

    // Dynamic discovery rendered in the explorer.
    const services = $$('.gatt-service');
    expect(services).toHaveLength(2);
    expect(services[0]!.textContent).toContain('Battery');
    const level = $(`.gatt-char[data-uuid="${TEST_UUIDS.batteryLevel}"]`);
    const badges = Array.from(level.querySelectorAll('.badge')).map((b) => b.textContent);
    expect(badges).toEqual(['Read', 'Notify']);

    // Read.
    level.querySelector<HTMLButtonElement>('[data-action="read"]')!.click();
    await waitFor(() => rows().some((r) => r.textContent!.includes('Battery Level · read')));

    // Notifications.
    $(`.gatt-char[data-uuid="${TEST_UUIDS.customNotify}"] [data-action="subscribe"]`).click();
    await waitFor(() => device.characteristic(TEST_UUIDS.customNotify).notifying);
    device.characteristic(TEST_UUIDS.customNotify).emit(new TextEncoder().encode('P21\r\n'));
    await waitFor(() => rows().some((r) => r.textContent!.includes('P21\\r\\n')));
    const rx = rows().find((r) => r.textContent!.includes('P21'))!;
    expect(rx.dataset.dir).toBe('rx');
    expect(rx.querySelector('.c-time')!.textContent).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
    expect(rx.querySelector('.c-tport')!.textContent).toBe('BLE');

    // Write with CRLF.
    const input = $<HTMLTextAreaElement>('[data-testid="send-input"]');
    setValue($<HTMLSelectElement>('[data-testid="line-ending"]'), 'crlf');
    setValue(input, 'HELLO', 'input');
    expect($('[data-testid="send-preview"]').textContent).toContain('48 45 4C 4C 4F 0D 0A');
    click('[data-testid="send"]');
    await waitFor(() => device.characteristic(TEST_UUIDS.customWrite).writes.length === 1);
    expect(device.characteristic(TEST_UUIDS.customWrite).writes[0]!.bytes).toEqual([
      0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0d, 0x0a,
    ]);
    await waitFor(() => rows().some((r) => r.dataset.dir === 'tx'));
    expect(input.value).toBe('');

    // Disconnect.
    click('[data-testid="disconnect"]');
    await waitFor(() => ctx.ble.state === 'disconnected');
    expect($('[data-testid="connection-status"]').textContent).toBe('Disconnected');
  });
});

describe('UI: Serial workflow', () => {
  it('uses the selected baud rate, shows RX/TX, handles unplug', async () => {
    const port = new MockSerialPort();
    const { $, rows, click, ctx } = mount({
      languages: ['en'],
      bluetooth: () => undefined,
      serial: new MockSerial(port),
    });
    click('#tab-serial');
    expect($<HTMLSelectElement>('[data-testid="baud-rate"]').value).toBe('9600');
    expect($<HTMLSelectElement>('[data-testid="data-bits"]').value).toBe('8');
    expect($<HTMLSelectElement>('[data-testid="stop-bits"]').value).toBe('1');
    expect($<HTMLSelectElement>('[data-testid="parity"]').value).toBe('none');
    expect($<HTMLSelectElement>('[data-testid="flow-control"]').value).toBe('none');
    setValue($<HTMLSelectElement>('[data-testid="baud-rate"]'), '115200');

    click('[data-testid="connect"]');
    await waitFor(() => ctx.serial.state === 'connected');
    expect(port.openOptions?.baudRate).toBe(115200);
    expect($('[data-testid="port-config"]').textContent).toBe('115200 8N1');
    expect($<HTMLSelectElement>('[data-testid="baud-rate"]').disabled).toBe(true);

    port.receive('P2');
    port.receive('1\r\n');
    await waitFor(() => rows().some((r) => r.textContent!.includes('P21\\r\\n')));

    // HEX input mode.
    click('[data-testid="send-format"] [data-value="hex"]');
    const input = $<HTMLTextAreaElement>('[data-testid="send-input"]');
    setValue(input, '50 32 32 0D 0A', 'input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => port.written.length === 1);
    expect(port.written[0]).toEqual([0x50, 0x32, 0x32, 0x0d, 0x0a]);

    // Invalid hex is reported and not sent.
    setValue(input, '5', 'input');
    expect($('[data-testid="send-preview"]').textContent).toContain('odd number');
    expect($<HTMLButtonElement>('[data-testid="send"]').disabled).toBe(true);

    port.unplug();
    await waitFor(() => ctx.serial.state === 'disconnected');
    await waitFor(() => rows().some((r) => r.dataset.dir === 'error'));
    expect(rows().at(-1)!.textContent).toContain('Connection lost.');
  });
});

describe('UI: terminal tools', () => {
  it('switches HEX / Text / mixed views, clears, toggles auto scroll and exports', async () => {
    const { $, rows, click, ctx } = mount({ languages: ['en'], bluetooth: () => undefined, serial: () => undefined });
    ctx.session.receive('serial', new TextEncoder().encode('P21\r\n'));
    await waitFor(() => rows().length === 1);
    expect(rows()[0]!.querySelector('.c-data')!.textContent).toBe('P21\\r\\n');

    click('[data-testid="view-mode"] [data-value="hex"]');
    await waitFor(() => rows()[0]?.querySelector('.c-data')!.textContent === '50 32 31 0D 0A');

    click('[data-testid="view-mode"] [data-value="mixed"]');
    await waitFor(() => !!rows()[0]?.querySelector('.hex + .txt'));
    expect(rows()[0]!.querySelector('.c-data')!.textContent).toBe('50 32 31 0D 0AP21\\r\\n');

    const autoscroll = $<HTMLInputElement>('[data-testid="autoscroll"]');
    expect(autoscroll.checked).toBe(true);
    autoscroll.checked = false;
    autoscroll.dispatchEvent(new Event('change'));
    expect(ctx.settings.value.autoScroll).toBe(false);

    // Export .txt / .csv: generated locally as a Blob.
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob);
      return 'blob:local';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    click('[data-testid="export-txt"]');
    click('[data-testid="export-csv"]');
    expect(downloads[0]).toMatch(/^online-terminal-\d{8}-\d{6}\.txt$/);
    expect(downloads[1]).toMatch(/\.csv$/);
    expect(await blobs[0]!.text()).toContain('50 32 31 0D 0A  |  P21\\r\\n');
    expect(await blobs[1]!.text()).toContain('timestamp_iso,local_time,transport,direction');

    click('[data-testid="clear"]');
    await waitFor(() => rows().length === 0);
    expect(ctx.log.size).toBe(0);
    expect($('[data-testid="stats"]').textContent).toBe('RX 0 B · TX 0 B');
  });
});
