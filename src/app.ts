/**
 * Application composition root: creates the services, wires the
 * transports to the terminal session and mounts the UI.
 */
import { createBrandBar } from './branding/brandBar';
import { I18n } from './i18n/i18n';
import { bindText, translateDom } from './i18n/dom';
import { SettingsStore } from './settings/settings';
import { createBrowserStorage, type KeyValueStorage } from './settings/storage';
import { TerminalLog } from './terminal/log';
import { TerminalSession } from './terminal/session';
import { BluetoothTransport, characteristicLabel } from './transport/ble/BluetoothTransport';
import { buildOptionalServices } from './transport/ble/knownUuids';
import { parseUuidList } from './transport/ble/uuid';
import { describeSerialConfig } from './transport/serial/serialConfig';
import { SerialTransport } from './transport/serial/SerialTransport';
import type { SerialLike } from './transport/serial/webSerial';
import type { BluetoothLike } from './transport/ble/webBluetooth';
import type { AppContext } from './ui/context';
import { createConnectionPanel } from './ui/connectionPanel';
import { h } from './ui/dom';
import { createGattExplorer } from './ui/gattExplorer';
import { createAppHeader } from './ui/header';
import { createModeTabs } from './ui/modeTabs';
import { createSendPanel } from './ui/sendPanel';
import { createSettingsPanel } from './ui/settingsPanel';
import { createTerminalView } from './ui/terminalView';

export interface AppOptions {
  storage?: KeyValueStorage;
  languages?: readonly string[];
  /** Test hooks: replace the browser APIs (defaults: navigator.*). */
  bluetooth?: BluetoothLike | (() => BluetoothLike | undefined);
  serial?: SerialLike | (() => SerialLike | undefined);
  isSecureContext?: () => boolean | undefined;
}

export function createContext(options: AppOptions = {}): AppContext {
  const storage = options.storage ?? createBrowserStorage();
  const i18n = options.languages ? new I18n(storage, options.languages) : new I18n(storage);
  const settings = new SettingsStore(storage);
  const log = new TerminalLog();
  const session = new TerminalSession(log, {
    framing: (kind) => {
      const s = settings.value[kind];
      return { mode: s.framing, idleMs: s.idleMs };
    },
  });

  const ble = new BluetoothTransport({
    bluetooth: options.bluetooth,
    isSecureContext: options.isSecureContext,
    getOptions: () => {
      const b = settings.value.ble;
      return {
        namePrefix: b.namePrefix,
        optionalServices: buildOptionalServices({
          includeCommonSerial: b.commonSerialServices,
          extra: parseUuidList(b.extraServices).uuids,
        }),
        autoSubscribe: b.autoSubscribe,
        chunkSize: b.chunkSize,
        writeMode: b.writeMode,
      };
    },
  });
  const serial = new SerialTransport({
    serial: options.serial,
    isSecureContext: options.isSecureContext,
    getConfig: () => settings.value.serial,
  });

  session.attach(ble);
  session.attach(serial);

  // Transport-specific, purely informative log lines.
  ble.on('state', (e) => {
    if (e.state !== 'connected') return;
    const services = ble.getServices();
    session.info('ble', 'log.discovered', {
      services: services.length,
      characteristics: ble.characteristicCount,
    });
  });
  ble.on('txTarget', (id) => {
    if (id === undefined || ble.state !== 'connected') return;
    const c = ble.getCharacteristic(id);
    if (c) session.info('ble', 'log.txTarget', { channel: characteristicLabel(c) });
  });
  ble.on('subscription', (e) =>
    session.info('ble', e.subscribed ? 'log.subscribed' : 'log.unsubscribed', { channel: e.channel }),
  );
  serial.on('state', (e) => {
    const cfg = serial.openConfig;
    if (e.state === 'connected' && cfg) {
      session.info('serial', 'log.portConfig', { config: describeSerialConfig(cfg) });
    }
  });

  return { i18n, settings, log, session, ble, serial };
}

export function mountApp(root: HTMLElement, ctx: AppContext): void {
  const { i18n } = ctx;

  const footerPrivacy = h('p', {});
  bindText(footerPrivacy, i18n, 'footer.privacy');
  const footerGeneric = h('p', {});
  bindText(footerGeneric, i18n, 'footer.generic');

  const layout = h(
    'main',
    { class: 'layout', id: 'main' },
    h(
      'div',
      { class: 'col col-side' },
      createModeTabs(ctx),
      createConnectionPanel(ctx),
      createSettingsPanel(ctx),
      createGattExplorer(ctx),
    ),
    h('div', { class: 'col col-main' }, createTerminalView(ctx), createSendPanel(ctx)),
  );

  root.replaceChildren(
    createBrandBar(i18n),
    createAppHeader(ctx),
    layout,
    h('footer', { class: 'app-footer' }, footerPrivacy, footerGeneric),
  );

  const applyLanguage = (): void => {
    document.documentElement.lang = i18n.language;
    document.title = `${i18n.t('app.title')} — ${i18n.t('mode.ble')} / ${i18n.t('mode.serial')}`;
    translateDom(root, i18n);
  };
  i18n.onChange(applyLanguage);
  applyLanguage();
}
