import { bindText } from '../i18n/dom';
import type { MessageKey } from '../i18n/i18n';
import {
  isSubscribable,
  isWritable,
  type BleCharacteristicInfo,
  type BleProperties,
  type BleServiceInfo,
} from '../transport/ble/BluetoothTransport';
import { formatUuid } from '../transport/ble/uuid';
import type { AppContext } from './context';
import { clear, h } from './dom';

const PROPERTY_BADGES: Array<[keyof BleProperties, MessageKey, string]> = [
  ['read', 'prop.read', 'R'],
  ['write', 'prop.write', 'W'],
  ['writeWithoutResponse', 'prop.writeWithoutResponse', 'WNR'],
  ['notify', 'prop.notify', 'N'],
  ['indicate', 'prop.indicate', 'I'],
];

/**
 * Dynamic view of the GATT services and characteristics discovered on the
 * connected BLE device, with per-characteristic actions.
 */
export function createGattExplorer(ctx: AppContext): HTMLElement {
  const { i18n, ble } = ctx;
  const title = h('h2', { class: 'card-title' });
  bindText(title, i18n, 'gatt.title');
  const summary = h('span', { class: 'card-subtitle', 'data-testid': 'gatt-summary' });
  const body = h('div', { class: 'gatt-body', 'data-testid': 'gatt' });
  const card = h(
    'section',
    { class: 'card card-gatt' },
    h('header', { class: 'card-header' }, title, summary),
    body,
  );
  const collapsed = new Set<string>();

  const run = async (op: () => Promise<unknown>): Promise<void> => {
    try {
      await op();
    } catch (err) {
      ctx.session.error('ble', err);
    }
  };

  const characteristicRow = (c: BleCharacteristicInfo): HTMLElement => {
    const name = h('span', { class: 'gatt-name' });
    if (c.name) name.textContent = c.name;
    else bindText(name, i18n, 'gatt.customCharacteristic');
    const uuid = h('code', { class: 'gatt-uuid' }, formatUuid(c.uuid));

    const badges = h('div', { class: 'badges' });
    for (const [prop, key, short] of PROPERTY_BADGES) {
      if (!c.properties[prop]) continue;
      const badge = h('span', { class: `badge badge-${prop}`, 'data-prop': prop });
      bindText(badge, i18n, key);
      badge.dataset.short = short;
      badges.appendChild(badge);
    }

    const actions = h('div', { class: 'gatt-actions' });
    if (c.properties.read) {
      const b = h('button', { type: 'button', class: 'btn btn-small', 'data-action': 'read' });
      bindText(b, i18n, 'gatt.read');
      b.addEventListener('click', () => void run(() => ble.read(c.id)));
      actions.appendChild(b);
    }
    if (isSubscribable(c.properties)) {
      const b = h('button', {
        type: 'button',
        class: 'btn btn-small' + (c.subscribed ? ' btn-active' : ''),
        'data-action': 'subscribe',
        'aria-pressed': String(c.subscribed),
      });
      bindText(b, i18n, c.subscribed ? 'gatt.unsubscribe' : 'gatt.subscribe');
      b.addEventListener('click', () =>
        void run(() => (c.subscribed ? ble.unsubscribe(c.id) : ble.subscribe(c.id))),
      );
      actions.appendChild(b);
    }
    if (isWritable(c.properties)) {
      const selected = ble.txTarget === c.id;
      const b = h('button', {
        type: 'button',
        class: 'btn btn-small' + (selected ? ' btn-active' : ''),
        'data-action': 'tx',
        'aria-pressed': String(selected),
      });
      bindText(b, i18n, selected ? 'gatt.txSelected' : 'gatt.useForTx');
      b.addEventListener('click', () => {
        try {
          ble.setTxTarget(c.id);
        } catch (err) {
          ctx.session.error('ble', err);
        }
      });
      actions.appendChild(b);
    }

    return h(
      'li',
      { class: 'gatt-char', 'data-uuid': c.uuid, 'data-id': c.id },
      h('div', { class: 'gatt-char-head' }, name, uuid),
      badges,
      actions,
    );
  };

  const serviceBlock = (s: BleServiceInfo): HTMLElement => {
    const details = h('details', { class: 'gatt-service', 'data-uuid': s.uuid });
    details.open = !collapsed.has(s.uuid);
    details.addEventListener('toggle', () => {
      if (details.open) collapsed.delete(s.uuid);
      else collapsed.add(s.uuid);
    });
    const name = h('span', { class: 'gatt-name' });
    if (s.name) name.textContent = s.name;
    else bindText(name, i18n, 'gatt.customService');
    const head = h(
      'summary',
      {},
      name,
      h('code', { class: 'gatt-uuid' }, formatUuid(s.uuid)),
    );
    const list = h('ul', { class: 'gatt-chars' });
    s.characteristics.forEach((c) => list.appendChild(characteristicRow(c)));
    details.append(head, list);
    return details;
  };

  const render = (): void => {
    card.hidden = ctx.settings.value.mode !== 'ble';
    clear(body);
    const services = ble.getServices();
    if (ble.state !== 'connected') {
      summary.textContent = '';
      delete summary.dataset.i18n;
      const p = h('p', { class: 'empty' });
      bindText(p, i18n, 'gatt.empty');
      body.appendChild(p);
      return;
    }
    const characteristics = services.reduce((n, s) => n + s.characteristics.length, 0);
    bindText(summary, i18n, 'gatt.summary', { services: services.length, characteristics });
    if (services.length === 0) {
      const p = h('p', { class: 'empty' });
      bindText(p, i18n, 'gatt.noServices');
      body.appendChild(p);
      return;
    }
    services.forEach((s) => body.appendChild(serviceBlock(s)));
  };

  ble.on('services', render);
  ble.on('txTarget', render);
  ble.on('state', render);
  ctx.settings.onChange(() => {
    card.hidden = ctx.settings.value.mode !== 'ble';
  });
  render();
  return card;
}
