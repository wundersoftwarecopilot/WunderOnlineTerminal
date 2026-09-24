import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installWebApiMocks, type MockOptions } from './webApiMocks';

/** Opens the app with the given API mocks and watches network + CSP. */
async function open(page: Page, mocks: MockOptions = { ble: 'mock', serial: 'mock' }) {
  const external: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== 'localhost' && url.protocol !== 'blob:' && url.protocol !== 'data:') {
      external.push(r.url());
    }
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.addInitScript(installWebApiMocks, mocks);
  await page.goto('/');
  await expect(page.locator('.app-title')).toHaveText('Online Terminal');
  return { external, problems };
}

const terminalRows = (page: Page) => page.locator('[data-testid="terminal"] .row');

test.describe('languages', () => {
  const cases: Array<[string, string, string]> = [
    ['it-IT', 'it', 'Connetti'],
    ['en-US', 'en', 'Connect'],
    ['es-AR', 'es', 'Conectar'],
    ['pt-BR', 'pt', 'Conectar'],
    ['fr-FR', 'fr', 'Connecter'],
    ['de-DE', 'de', 'Verbinden'],
    ['ja-JP', 'en', 'Connect'], // unsupported -> English
  ];
  for (const [locale, lang, connect] of cases) {
    test(`${locale} -> ${lang}`, async ({ browser }) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await open(page);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.getByTestId('connect')).toHaveText(connect);
      await context.close();
    });
  }

  test('manual choice wins over the browser language and persists', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'it-IT' });
    const page = await context.newPage();
    await open(page);
    await page.locator('.lang-select').selectOption('fr');
    await expect(page.getByTestId('connect')).toHaveText('Connecter');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('connect')).toHaveText('Connecter');
    await expect(page.locator('.lang-select')).toHaveValue('fr');
    await context.close();
  });
});

test.describe('compatibility', () => {
  test('unsupported browser: clear message, page keeps working', async ({ page }) => {
    const { problems } = await open(page, { ble: 'none', serial: 'none' });
    await expect(page.getByTestId('support-message')).toHaveText(
      'Web Bluetooth is not supported by this browser.',
    );
    await expect(page.getByTestId('connect')).toBeDisabled();
    await page.locator('#tab-serial').click();
    await expect(page.getByTestId('support-message')).toHaveText(
      'Web Serial is not supported by this browser.',
    );
    await page.getByTestId('view-mode').getByText('HEX', { exact: true }).click();
    await expect(page.getByTestId('view-mode').locator('[aria-checked="true"]')).toHaveText('HEX');
    expect(problems).toEqual([]);
  });
});

test.describe('BLE', () => {
  test('discovery, read, notifications, write, export, disconnect', async ({ page }) => {
    const { external, problems } = await open(page);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connection-status')).toHaveText('Connected');
    await expect(page.getByTestId('device-name')).toHaveText('Mock Peripheral');

    // requestDevice() used the generic, dynamic configuration.
    const request = await page.evaluate(() => (window as any).__mock.requests[0]);
    expect(request.acceptAllDevices).toBe(true);
    expect(request.optionalServices).toContain(0x180f);

    // Services discovered dynamically.
    await expect(page.locator('.gatt-service')).toHaveCount(2);
    await expect(page.getByTestId('gatt-summary')).toHaveText('2 services · 3 characteristics');
    const level = page.locator('.gatt-char[data-uuid="00002a19-0000-1000-8000-00805f9b34fb"]');
    await expect(level.locator('.badge')).toHaveText(['Read', 'Notify']);
    const custom = page.locator('.gatt-char[data-uuid="0000abc1-1111-4000-8000-000000000001"] .badge');
    await expect(custom).toHaveText(['Write', 'Write Without Response']);

    // Auto-subscribed by default; read the battery level.
    await level.locator('[data-action="read"]').click();
    const readRow = terminalRows(page).filter({ hasText: 'Battery Level · read' });
    await expect(readRow).toHaveCount(1);
    await expect(readRow.locator('.txt')).toHaveText('W'); // 87 = 0x57

    // Notification.
    await page.evaluate(() => (window as any).__mock.ble.notify('P21\r\n'));
    const rx = terminalRows(page).filter({ hasText: 'P21\\r\\n' });
    await expect(rx).toHaveCount(1);
    await expect(rx.locator('.c-dir')).toHaveText('RX');
    await expect(rx.locator('.c-tport')).toHaveText('BLE');
    await expect(rx.locator('.c-time')).toHaveText(/^\d\d:\d\d:\d\d\.\d{3}$/);

    // Write TEXT with CRLF.
    await page.getByTestId('line-ending').selectOption('crlf');
    await page.getByTestId('send-input').fill('HELLO');
    await expect(page.getByTestId('send-preview')).toContainText('48 45 4C 4C 4F 0D 0A');
    await page.getByTestId('send').click();
    await expect(terminalRows(page).filter({ hasText: 'TX' }).last()).toContainText('HELLO\\r\\n');

    // Write HEX (escapes are also available in text mode).
    await page.getByTestId('line-ending').selectOption('none');
    await page.getByTestId('send-format').getByText('HEX', { exact: true }).click();
    await page.getByTestId('send-input').fill('01 02 FF');
    await page.getByTestId('send-input').press('Enter');
    await expect
      .poll(() => page.evaluate(() => (window as any).__mock.bleWrites))
      .toEqual([
        [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0d, 0x0a],
        [0x01, 0x02, 0xff],
      ]);

    // HEX and mixed views.
    await page.getByTestId('view-mode').getByText('HEX', { exact: true }).click();
    await expect(terminalRows(page).filter({ hasText: '50 32 31 0D 0A' })).toHaveCount(1);
    await expect(terminalRows(page).filter({ hasText: 'P21' })).toHaveCount(0);
    await page.getByTestId('view-mode').getByText('HEX + Text').click();
    await expect(terminalRows(page).filter({ hasText: '50 32 31 0D 0A' })).toContainText('P21\\r\\n');

    // Export .txt and .csv (generated locally).
    const [txt] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-txt').click()]);
    expect(txt.suggestedFilename()).toMatch(/^online-terminal-\d{8}-\d{6}\.txt$/);
    const txtContent = readFileSync((await txt.path())!, 'utf8');
    expect(txtContent).toContain('# Online Terminal — session log');
    expect(txtContent).toMatch(/BLE\s+RX\s+\[[^\]]+\]\s+50 32 31 0D 0A {2}\| {2}P21\\r\\n/);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    expect(readFileSync((await csv.path())!, 'utf8')).toContain('timestamp_iso,local_time,transport,direction');

    // Connection lost.
    await page.evaluate(() => (window as any).__mock.ble.lose());
    await expect(page.getByTestId('connection-status')).toHaveText('Disconnected');
    await expect(terminalRows(page).last()).toContainText('Connection lost.');

    expect(external).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('cancelled chooser is reported as information', async ({ page }) => {
    await open(page);
    await page.evaluate(() => ((window as any).__mock.cancelNext = true));
    await page.getByTestId('connect').click();
    await expect(terminalRows(page).last()).toContainText('No device selected.');
    await expect(terminalRows(page).last()).toHaveAttribute('data-dir', 'info');
    await expect(page.getByTestId('connection-status')).toHaveText('Disconnected');
  });
});

test.describe('Serial', () => {
  test('8N1 defaults, baud rate, RX/TX, unplug', async ({ page }) => {
    const { external, problems } = await open(page);
    await page.locator('#tab-serial').click();
    await expect(page.getByTestId('baud-rate')).toHaveValue('9600');
    await expect(page.getByTestId('data-bits')).toHaveValue('8');
    await expect(page.getByTestId('stop-bits')).toHaveValue('1');
    await expect(page.getByTestId('parity')).toHaveValue('none');
    await expect(page.getByTestId('flow-control')).toHaveValue('none');

    await page.getByTestId('baud-rate').selectOption('57600');
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connection-status')).toHaveText('Connected');
    await expect(page.getByTestId('device-name')).toHaveText('USB 0403:6001');
    await expect(page.getByTestId('port-config')).toHaveText('57600 8N1');
    expect(await page.evaluate(() => (window as any).__mock.openOptions)).toMatchObject({
      baudRate: 57600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });

    await page.evaluate(() => (window as any).__mock.serial.receive('Temperature: 21.5 °C\r\n'));
    await expect(terminalRows(page).filter({ hasText: 'Temperature: 21.5 °C\\r\\n' })).toHaveCount(1);
    await page.evaluate(() => (window as any).__mock.serial.receiveBytes([0x00, 0xff, 0x0a]));
    await expect(terminalRows(page).filter({ hasText: '\\0\\xFF\\n' })).toHaveCount(1);

    await page.getByTestId('line-ending').selectOption('lf');
    await page.getByTestId('send-input').fill('READ\\r');
    await page.getByTestId('send').click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__mock.serialWritten))
      .toEqual([[0x52, 0x45, 0x41, 0x44, 0x0d, 0x0a]]);
    await expect(terminalRows(page).filter({ hasText: 'READ\\r\\n' }).locator('.c-tport')).toHaveText('SER');

    // Settings are locked while the port is open.
    await expect(page.getByTestId('baud-rate')).toBeDisabled();

    await page.evaluate(() => (window as any).__mock.serial.unplug());
    await expect(page.getByTestId('connection-status')).toHaveText('Disconnected');
    await expect(terminalRows(page).last()).toContainText('Connection lost.');
    await expect(page.getByTestId('baud-rate')).toBeEnabled();

    expect(external).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('terminal', () => {
  test('clear and auto scroll', async ({ page }) => {
    await open(page);
    await page.locator('#tab-serial').click();
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('connection-status')).toHaveText('Connected');
    const out = page.getByTestId('terminal');
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}\n`).join('');
    await page.evaluate((t) => (window as any).__mock.serial.receive(t), lines);
    await expect(terminalRows(page).filter({ hasText: 'line 119' })).toHaveCount(1);
    const atBottom = () =>
      out.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 4);
    await expect.poll(atBottom).toBe(true);

    await page.getByTestId('autoscroll').uncheck();
    await out.evaluate((el) => (el.scrollTop = 0));
    await page.evaluate(() => (window as any).__mock.serial.receive('more\n'));
    await expect(terminalRows(page).filter({ hasText: 'more' })).toHaveCount(1);
    expect(await out.evaluate((el) => el.scrollTop)).toBe(0);

    await page.getByTestId('clear').click();
    await expect(terminalRows(page)).toHaveCount(0);
    await expect(page.getByTestId('stats')).toHaveText('RX 0 B · TX 0 B');
  });
});

test.describe('privacy and branding', () => {
  test('the production page is protected by a CSP that forbids network connections', async ({ page }) => {
    await open(page);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("connect-src 'none'");
    // Any connection attempt is stopped by the browser itself (CSP violation).
    const violated = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener('securitypolicyviolation', (e) => resolve(e.effectiveDirective), {
            once: true,
          });
          fetch('https://example.com/').catch(() => undefined);
        }),
    );
    expect(violated).toBe('connect-src');
  });

  test('publisher logo and contacts', async ({ page }) => {
    await open(page);
    const home = page.locator('.brand-home');
    await expect(home).toHaveAttribute('href', 'https://www.wunder.it');
    await expect(home).toHaveAttribute('target', '_blank');
    await expect(home).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(home.locator('img')).toBeVisible();
    await expect(page.locator('a[href="mailto:wunder@wunder.it"]')).toBeVisible();
    await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
    const box = await page.locator('.brand-contacts').boundingBox();
    const logo = await home.boundingBox();
    expect(logo!.x).toBeLessThan(box!.x); // logo left, contacts right
  });

  test('responsive: no horizontal scrolling on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: 'de-DE' });
    const page = await context.newPage();
    await open(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
