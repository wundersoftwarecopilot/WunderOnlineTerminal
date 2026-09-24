import { bindText } from '../i18n/dom';
import type { MessageKey } from '../i18n/i18n';
import { describeSerialConfig } from '../transport/serial/serialConfig';
import type { TransportKind } from '../transport/types';
import { activeTransport, type AppContext } from './context';
import { clear, h } from './dom';
import { icon } from './icons';

/** Connection card: device, status, connect / disconnect. */
export function createConnectionPanel(ctx: AppContext): HTMLElement {
  const { i18n } = ctx;

  const title = h('h2', { class: 'card-title' });
  bindText(title, i18n, 'conn.title');
  const modeName = h('span', { class: 'card-subtitle' });

  const support = h('div', { class: 'alert alert-warning', role: 'alert', hidden: true });

  const deviceLabel = h('dt', {});
  const deviceValue = h('dd', { class: 'device-name', 'data-testid': 'device-name' });
  const statusLabel = h('dt', {});
  bindText(statusLabel, i18n, 'conn.status');
  const statusValue = h('dd', {});
  const statusBadge = h('span', { class: 'status-badge', 'data-testid': 'connection-status' });
  statusValue.appendChild(statusBadge);
  const configRow = h('div', { class: 'kv-row', hidden: true });
  const configValue = h('dd', { class: 'mono', 'data-testid': 'port-config' });
  const configLabel = h('dt', {});
  bindText(configLabel, i18n, 'settings.title');
  configRow.append(configLabel, configValue);

  const details = h(
    'dl',
    { class: 'kv' },
    h('div', { class: 'kv-row' }, deviceLabel, deviceValue),
    h('div', { class: 'kv-row' }, statusLabel, statusValue),
    configRow,
  );

  const connectLabel = h('span', {});
  bindText(connectLabel, i18n, 'conn.connect');
  const connectBtn = h(
    'button',
    { type: 'button', class: 'btn btn-primary', 'data-testid': 'connect' },
    icon('plug', 16),
    connectLabel,
  );
  const disconnectLabel = h('span', {});
  bindText(disconnectLabel, i18n, 'conn.disconnect');
  const disconnectBtn = h(
    'button',
    { type: 'button', class: 'btn', 'data-testid': 'disconnect' },
    disconnectLabel,
  );

  const privacy = h('p', { class: 'note' }, icon('shield', 14));
  const privacyText = h('span', {});
  bindText(privacyText, i18n, 'conn.privacyNote');
  privacy.appendChild(privacyText);

  const card = h(
    'section',
    { class: 'card card-connection', id: 'panel-connection', role: 'tabpanel' },
    h('header', { class: 'card-header' }, title, modeName),
    support,
    details,
    h('div', { class: 'btn-row' }, connectBtn, disconnectBtn),
    privacy,
  );

  const renderSupport = (kind: TransportKind): boolean => {
    const status = activeTransport(ctx).checkSupport();
    clear(support);
    if (status.supported) {
      support.hidden = true;
      return true;
    }
    const main: MessageKey =
      status.reason === 'insecureContext'
        ? 'support.insecure'
        : kind === 'ble'
          ? 'support.bleNoApi'
          : 'support.serialNoApi';
    const hint: MessageKey = kind === 'ble' ? 'support.hintBle' : 'support.hintSerial';
    const strong = h('strong', { 'data-testid': 'support-message' });
    bindText(strong, i18n, main);
    const small = h('span', { class: 'alert-hint' });
    bindText(small, i18n, hint);
    support.append(icon('alert', 18), h('div', {}, strong, small));
    support.hidden = false;
    return false;
  };

  const render = (): void => {
    const kind = ctx.settings.value.mode;
    const transport = activeTransport(ctx);
    card.dataset.mode = kind;
    card.setAttribute('aria-labelledby', `tab-${kind}`);
    bindText(modeName, i18n, kind === 'ble' ? 'mode.bleLong' : 'mode.serialLong');
    const supported = renderSupport(kind);

    bindText(deviceLabel, i18n, kind === 'ble' ? 'conn.device' : 'conn.port');
    const state = transport.state;
    const active = state === 'connected' || state === 'connecting' || state === 'disconnecting';
    if (state === 'connected' || state === 'disconnecting') {
      if (transport.deviceName) {
        delete deviceValue.dataset.i18n;
        deviceValue.textContent = transport.deviceName;
      } else {
        bindText(deviceValue, i18n, kind === 'ble' ? 'conn.unnamedDevice' : 'conn.serialPort');
      }
    } else {
      bindText(deviceValue, i18n, 'conn.none');
    }

    statusBadge.dataset.state = state;
    bindText(statusBadge, i18n, `state.${state}` as MessageKey);

    const openConfig = kind === 'serial' && state === 'connected' ? ctx.serial.openConfig : undefined;
    configRow.hidden = !openConfig;
    configValue.textContent = openConfig ? describeSerialConfig(openConfig) : '';

    connectBtn.disabled = !supported || active;
    disconnectBtn.disabled = state === 'disconnected' || state === 'disconnecting';
  };

  connectBtn.addEventListener('click', async () => {
    const transport = activeTransport(ctx);
    try {
      await transport.connect();
    } catch (err) {
      ctx.session.error(transport.kind, err);
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    const transport = activeTransport(ctx);
    try {
      await transport.disconnect();
    } catch (err) {
      ctx.session.error(transport.kind, err);
    }
  });

  ctx.settings.onChange(render);
  ctx.ble.on('state', render);
  ctx.serial.on('state', render);
  render();
  return card;
}
