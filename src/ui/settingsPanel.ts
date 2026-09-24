import { FRAMING_MODES, MAX_IDLE_MS, MIN_IDLE_MS, type FramingMode } from '../core/framer';
import { bindText } from '../i18n/dom';
import type { MessageKey } from '../i18n/i18n';
import { BLE_WRITE_MODES } from '../settings/settings';
import { BLE_MAX_CHUNK, type BleWriteMode } from '../transport/ble/BluetoothTransport';
import { parseUuidList } from '../transport/ble/uuid';
import {
  COMMON_BAUD_RATES,
  DATA_BITS,
  FLOW_CONTROLS,
  MAX_BAUD_RATE,
  MIN_BAUD_RATE,
  PARITIES,
  STOP_BITS,
  isValidBaudRate,
} from '../transport/serial/serialConfig';
import type { DataBits, FlowControl, Parity, StopBits } from '../transport/serial/webSerial';
import type { TransportKind } from '../transport/types';
import type { AppContext } from './context';
import { h, select } from './dom';
import { checkbox, field, labelOptions } from './form';

const CUSTOM = 'custom';

/** RX grouping controls, shared by both transports. */
function rxGroupingFields(ctx: AppContext, kind: TransportKind) {
  const current = ctx.settings.value[kind];
  const framing = select(FRAMING_MODES, current.framing, { 'data-testid': `${kind}-framing` });
  labelOptions(ctx.i18n, framing, (v) => `framing.${v}` as MessageKey);
  const idle = h('input', {
    type: 'number',
    min: MIN_IDLE_MS,
    max: MAX_IDLE_MS,
    step: 1,
    inputmode: 'numeric',
    value: current.idleMs,
  });

  const apply = (): void => {
    const idleMs = Number(idle.value);
    ctx.settings.update({
      [kind]: {
        framing: framing.value as FramingMode,
        ...(Number.isInteger(idleMs) && idleMs >= MIN_IDLE_MS && idleMs <= MAX_IDLE_MS
          ? { idleMs }
          : {}),
      },
    });
    ctx.session.refreshFraming(kind);
  };
  framing.addEventListener('change', apply);
  idle.addEventListener('change', apply);

  const sync = (): void => {
    const s = ctx.settings.value[kind];
    framing.value = s.framing;
    if (document.activeElement !== idle) idle.value = String(s.idleMs);
    idle.disabled = s.framing === 'none';
  };
  return {
    el: h(
      'div',
      { class: 'field-grid' },
      field(ctx.i18n, 'rx.grouping', framing),
      field(ctx.i18n, 'rx.idleMs', idle),
    ),
    sync,
  };
}

function restoreButton(ctx: AppContext, kind: TransportKind): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'btn btn-small btn-ghost' });
  bindText(btn, ctx.i18n, 'settings.restoreDefaults');
  btn.addEventListener('click', () => {
    ctx.settings.resetTransport(kind);
    ctx.session.refreshFraming(kind);
  });
  return btn;
}

function createSerialSettings(ctx: AppContext) {
  const { i18n } = ctx;
  const s = ctx.settings.value.serial;

  const baud = h('select', { 'data-testid': 'baud-rate' });
  for (const rate of COMMON_BAUD_RATES) baud.appendChild(h('option', { value: rate }, String(rate)));
  const customOption = h('option', { value: CUSTOM });
  bindText(customOption, i18n, 'serial.custom');
  baud.appendChild(customOption);

  const customBaud = h('input', {
    type: 'number',
    min: MIN_BAUD_RATE,
    max: MAX_BAUD_RATE,
    step: 1,
    inputmode: 'numeric',
    'data-testid': 'custom-baud',
  });
  const customField = field(i18n, 'serial.customBaud', customBaud);

  const dataBits = select(DATA_BITS, s.dataBits, { 'data-testid': 'data-bits' });
  const stopBits = select(STOP_BITS, s.stopBits, { 'data-testid': 'stop-bits' });
  const parity = select(PARITIES, s.parity, { 'data-testid': 'parity' });
  labelOptions(i18n, parity, (v) => `parity.${v}` as MessageKey);
  const flow = select(FLOW_CONTROLS, s.flowControl, { 'data-testid': 'flow-control' });
  labelOptions(i18n, flow, (v) => `flow.${v}` as MessageKey);

  const rx = rxGroupingFields(ctx, 'serial');
  const note = h('p', { class: 'note note-info', hidden: true });
  bindText(note, i18n, 'settings.appliedOnConnect');

  let customMode = !COMMON_BAUD_RATES.includes(s.baudRate);

  baud.addEventListener('change', () => {
    if (baud.value === CUSTOM) {
      customMode = true;
      customBaud.value = String(ctx.settings.value.serial.baudRate);
      sync();
      customBaud.focus();
      return;
    }
    customMode = false;
    ctx.settings.update({ serial: { baudRate: Number(baud.value) } });
  });
  customBaud.addEventListener('change', () => {
    const value = Number(customBaud.value);
    if (isValidBaudRate(value)) ctx.settings.update({ serial: { baudRate: value } });
    else customBaud.value = String(ctx.settings.value.serial.baudRate);
  });
  dataBits.addEventListener('change', () =>
    ctx.settings.update({ serial: { dataBits: Number(dataBits.value) as DataBits } }),
  );
  stopBits.addEventListener('change', () =>
    ctx.settings.update({ serial: { stopBits: Number(stopBits.value) as StopBits } }),
  );
  parity.addEventListener('change', () =>
    ctx.settings.update({ serial: { parity: parity.value as Parity } }),
  );
  flow.addEventListener('change', () =>
    ctx.settings.update({ serial: { flowControl: flow.value as FlowControl } }),
  );

  const advanced = h('details', { class: 'advanced' });
  const summary = h('summary', {});
  bindText(summary, i18n, 'settings.advanced');
  advanced.append(summary, rx.el);

  const el = h(
    'div',
    { class: 'settings-body', 'data-testid': 'serial-settings' },
    h(
      'div',
      { class: 'field-grid' },
      field(i18n, 'serial.baudRate', baud),
      customField,
      field(i18n, 'serial.dataBits', dataBits),
      field(i18n, 'serial.stopBits', stopBits),
      field(i18n, 'serial.parity', parity),
      field(i18n, 'serial.flowControl', flow),
    ),
    note,
    advanced,
    h('div', { class: 'btn-row btn-row-end' }, restoreButton(ctx, 'serial')),
  );

  const sync = (): void => {
    const cfg = ctx.settings.value.serial;
    if (!COMMON_BAUD_RATES.includes(cfg.baudRate)) customMode = true;
    baud.value = customMode ? CUSTOM : String(cfg.baudRate);
    customField.hidden = !customMode;
    if (document.activeElement !== customBaud) customBaud.value = String(cfg.baudRate);
    dataBits.value = String(cfg.dataBits);
    stopBits.value = String(cfg.stopBits);
    parity.value = cfg.parity;
    flow.value = cfg.flowControl;
    const locked = ctx.serial.state !== 'disconnected';
    for (const c of [baud, customBaud, dataBits, stopBits, parity, flow]) c.disabled = locked;
    note.hidden = !locked;
    rx.sync();
  };
  return { el, sync };
}

function createBleSettings(ctx: AppContext) {
  const { i18n } = ctx;
  const b = ctx.settings.value.ble;

  const namePrefix = h('input', {
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: 64,
    value: b.namePrefix,
    'data-testid': 'ble-name-prefix',
  });
  const common = checkbox(i18n, 'ble.commonSerial', b.commonSerialServices);
  const extra = h('textarea', {
    rows: 2,
    spellcheck: 'false',
    autocomplete: 'off',
    class: 'mono',
    placeholder: '180F, 6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    'data-testid': 'ble-extra-services',
  });
  extra.value = b.extraServices;
  const invalid = h('p', { class: 'field-error', role: 'status', hidden: true });
  const autoSubscribe = checkbox(i18n, 'ble.autoSubscribe', b.autoSubscribe);
  const writeMode = select(BLE_WRITE_MODES, b.writeMode, { 'data-testid': 'ble-write-mode' });
  labelOptions(i18n, writeMode, (v) => `write.${v}` as MessageKey);
  const chunk = h('input', {
    type: 'number',
    min: 1,
    max: BLE_MAX_CHUNK,
    step: 1,
    inputmode: 'numeric',
    value: b.chunkSize,
    'data-testid': 'ble-chunk-size',
  });
  const rx = rxGroupingFields(ctx, 'ble');
  const note = h('p', { class: 'note note-info', hidden: true });
  bindText(note, i18n, 'settings.appliedOnConnect');

  namePrefix.addEventListener('change', () =>
    ctx.settings.update({ ble: { namePrefix: namePrefix.value.trim() } }),
  );
  common.input.addEventListener('change', () =>
    ctx.settings.update({ ble: { commonSerialServices: common.input.checked } }),
  );
  extra.addEventListener('change', () => ctx.settings.update({ ble: { extraServices: extra.value } }));
  autoSubscribe.input.addEventListener('change', () =>
    ctx.settings.update({ ble: { autoSubscribe: autoSubscribe.input.checked } }),
  );
  writeMode.addEventListener('change', () =>
    ctx.settings.update({ ble: { writeMode: writeMode.value as BleWriteMode } }),
  );
  chunk.addEventListener('change', () => {
    const value = Number(chunk.value);
    if (Number.isInteger(value) && value >= 1 && value <= BLE_MAX_CHUNK) {
      ctx.settings.update({ ble: { chunkSize: value } });
    } else {
      chunk.value = String(ctx.settings.value.ble.chunkSize);
    }
  });

  const advanced = h('details', { class: 'advanced' });
  const summary = h('summary', {});
  bindText(summary, i18n, 'settings.advanced');
  advanced.append(
    summary,
    field(i18n, 'ble.extraServices', extra, 'ble.extraServicesHint'),
    invalid,
    common.el,
    autoSubscribe.el,
    h(
      'div',
      { class: 'field-grid' },
      field(i18n, 'ble.writeMode', writeMode),
      field(i18n, 'ble.chunkSize', chunk),
    ),
    rx.el,
  );

  const el = h(
    'div',
    { class: 'settings-body', 'data-testid': 'ble-settings' },
    field(i18n, 'ble.namePrefix', namePrefix, 'ble.namePrefixHint'),
    note,
    advanced,
    h('div', { class: 'btn-row btn-row-end' }, restoreButton(ctx, 'ble')),
  );

  const sync = (): void => {
    const s = ctx.settings.value.ble;
    if (document.activeElement !== namePrefix) namePrefix.value = s.namePrefix;
    if (document.activeElement !== extra) extra.value = s.extraServices;
    common.input.checked = s.commonSerialServices;
    autoSubscribe.input.checked = s.autoSubscribe;
    writeMode.value = s.writeMode;
    if (document.activeElement !== chunk) chunk.value = String(s.chunkSize);
    const { invalid: bad } = parseUuidList(s.extraServices);
    invalid.hidden = bad.length === 0;
    if (bad.length) bindText(invalid, i18n, 'ble.invalidUuids', { list: bad.join(', ') });
    const locked = ctx.ble.state !== 'disconnected';
    for (const c of [namePrefix, extra, common.input, autoSubscribe.input]) c.disabled = locked;
    note.hidden = !locked;
    rx.sync();
  };
  return { el, sync };
}

/** "Communication settings" card; content depends on the active mode. */
export function createSettingsPanel(ctx: AppContext): HTMLElement {
  const title = h('h2', { class: 'card-title' });
  bindText(title, ctx.i18n, 'settings.title');
  const serial = createSerialSettings(ctx);
  const ble = createBleSettings(ctx);
  const card = h(
    'section',
    { class: 'card card-settings' },
    h('header', { class: 'card-header' }, title),
    ble.el,
    serial.el,
  );
  const render = (): void => {
    const mode = ctx.settings.value.mode;
    ble.el.hidden = mode !== 'ble';
    serial.el.hidden = mode !== 'serial';
    ble.sync();
    serial.sync();
  };
  ctx.settings.onChange(render);
  ctx.ble.on('state', render);
  ctx.serial.on('state', render);
  render();
  return card;
}
