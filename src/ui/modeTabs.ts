import { bindText } from '../i18n/dom';
import type { TransportKind } from '../transport/types';
import { transportOf, type AppContext } from './context';
import { h } from './dom';
import { icon } from './icons';

/** BLE / SERIAL selector. Both transports can stay connected at once. */
export function createModeTabs(ctx: AppContext): HTMLElement {
  const nav = h('div', { class: 'mode-tabs', role: 'tablist' });
  bindText(nav, ctx.i18n, 'mode.label', {}, 'aria-label');
  const tabs = new Map<TransportKind, HTMLButtonElement>();

  const make = (kind: TransportKind): HTMLButtonElement => {
    const label = h('span', { class: 'mode-tab-label' });
    bindText(label, ctx.i18n, kind === 'ble' ? 'mode.ble' : 'mode.serial');
    const dot = h('span', { class: 'status-dot', 'aria-hidden': 'true' });
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: 'mode-tab',
        id: `tab-${kind}`,
        'data-mode': kind,
        'aria-controls': 'panel-connection',
      },
      icon(kind === 'ble' ? 'bluetooth' : 'serial', 16),
      label,
      dot,
    );
    bindText(btn, ctx.i18n, kind === 'ble' ? 'mode.bleLong' : 'mode.serialLong', {}, 'title');
    btn.addEventListener('click', () => ctx.settings.update({ mode: kind }));
    tabs.set(kind, btn);
    return btn;
  };

  nav.append(make('ble'), make('serial'));

  const refresh = (): void => {
    for (const [kind, btn] of tabs) {
      const selected = ctx.settings.value.mode === kind;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
      btn.dataset.state = transportOf(ctx, kind).state;
    }
  };

  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next: TransportKind = ctx.settings.value.mode === 'ble' ? 'serial' : 'ble';
    ctx.settings.update({ mode: next });
    tabs.get(next)?.focus();
    e.preventDefault();
  });

  ctx.settings.onChange(refresh);
  ctx.ble.on('state', refresh);
  ctx.serial.on('state', refresh);
  refresh();
  return nav;
}
