import { bytesToHex } from '../core/bytes';
import { LINE_ENDINGS, type LineEnding } from '../core/lineEnding';
import { buildPayload, type InputMode } from '../core/payload';
import { bindText } from '../i18n/dom';
import type { MessageKey } from '../i18n/i18n';
import { characteristicLabel, isWritable } from '../transport/ble/BluetoothTransport';
import { activeTransport, type AppContext } from './context';
import { clear, h, select } from './dom';
import { checkbox, field, labelOptions, segmented } from './form';
import { icon } from './icons';

const MAX_HISTORY = 50;
const PREVIEW_BYTES = 64;

/** "Send" card: input, format, line ending, preview and send button. */
export function createSendPanel(ctx: AppContext): HTMLElement {
  const { i18n, settings } = ctx;

  const title = h('h2', { class: 'card-title' });
  bindText(title, i18n, 'send.title');

  const format = segmented<InputMode>(
    i18n,
    'send.format',
    [
      { value: 'text', key: 'send.text' },
      { value: 'hex', key: 'send.hex' },
    ],
    settings.value.inputMode,
    (value) => settings.update({ inputMode: value }),
    'send-format',
  );

  const lineEnding = select(LINE_ENDINGS, settings.value.lineEnding, { 'data-testid': 'line-ending' });
  labelOptions(i18n, lineEnding, (v) => `le.${v}` as MessageKey);
  lineEnding.addEventListener('change', () =>
    settings.update({ lineEnding: lineEnding.value as LineEnding }),
  );

  const escapes = checkbox(i18n, 'send.escapes', settings.value.escapes, { 'data-testid': 'escapes' });
  escapes.input.addEventListener('change', () => settings.update({ escapes: escapes.input.checked }));

  // BLE only: characteristic used for writing.
  const target = h('select', { 'data-testid': 'ble-target' });
  const targetField = field(i18n, 'send.target', target);
  target.addEventListener('change', () => {
    try {
      ctx.ble.setTxTarget(target.value || undefined);
    } catch (err) {
      ctx.session.error('ble', err);
    }
  });

  const input = h('textarea', {
    rows: 3,
    class: 'send-input mono',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    'data-testid': 'send-input',
  });
  const inputField = field(i18n, 'send.title', input, 'send.historyHint');
  inputField.classList.add('field-send');

  const preview = h('p', { class: 'send-preview mono', 'data-testid': 'send-preview', role: 'status' });
  const hint = h('p', { class: 'note', 'data-testid': 'send-hint' });

  const sendText = h('span', {});
  bindText(sendText, i18n, 'send.button');
  const sendBtn = h(
    'button',
    { type: 'button', class: 'btn btn-primary', 'data-testid': 'send' },
    icon('send', 16),
    sendText,
  );

  const card = h(
    'section',
    { class: 'card card-send' },
    h('header', { class: 'card-header' }, title),
    h(
      'div',
      { class: 'send-options' },
      format.el,
      field(i18n, 'send.lineEnding', lineEnding),
      escapes.el,
      targetField,
    ),
    inputField,
    preview,
    h('div', { class: 'send-actions' }, hint, sendBtn),
  );

  const history: string[] = [];
  let historyIndex = -1;
  let draft = '';

  const payload = () =>
    buildPayload(input.value, {
      mode: settings.value.inputMode,
      lineEnding: settings.value.lineEnding,
      escapes: settings.value.escapes,
    });

  const renderTargets = (): void => {
    const isBle = settings.value.mode === 'ble';
    const writable = ctx.ble
      .getServices()
      .flatMap((s) => s.characteristics.filter((c) => isWritable(c.properties)));
    targetField.hidden = !isBle || ctx.ble.state !== 'connected' || writable.length === 0;
    clear(target);
    const none = h('option', { value: '' }, '—');
    target.appendChild(none);
    for (const c of writable) {
      const o = h('option', { value: c.id }, characteristicLabel(c));
      target.appendChild(o);
    }
    target.value = ctx.ble.txTarget ?? '';
  };

  const update = (): void => {
    const s = settings.value;
    format.set(s.inputMode);
    lineEnding.value = s.lineEnding;
    escapes.input.checked = s.escapes;
    escapes.el.hidden = s.inputMode !== 'text';
    bindText(input, i18n, s.inputMode === 'hex' ? 'send.placeholderHex' : 'send.placeholderText', undefined, 'placeholder');

    const transport = activeTransport(ctx);
    const connected = transport.state === 'connected';
    const canSend = transport.canSend();

    const result = payload();
    clear(preview);
    preview.classList.remove('is-error');
    let valid = false;
    if (input.value.length > 0 || s.lineEnding !== 'none') {
      if (result.ok) {
        valid = true;
        const shown = result.bytes.subarray(0, PREVIEW_BYTES);
        const label = h('span', { class: 'send-preview-label' });
        bindText(label, i18n, 'send.preview', { count: result.bytes.length });
        preview.append(
          label,
          ' ',
          bytesToHex(shown) + (result.bytes.length > PREVIEW_BYTES ? ' …' : ''),
        );
      } else {
        preview.classList.add('is-error');
        const err = result.error;
        const span = h('span', {});
        if (err.code === 'invalidChar') {
          bindText(span, i18n, 'hex.invalidChar', { char: err.char, position: err.position + 1 });
        } else if (err.code === 'oddDigits') {
          bindText(span, i18n, 'hex.oddDigits', { token: err.token });
        } else {
          bindText(span, i18n, 'hex.empty');
        }
        preview.appendChild(span);
      }
    }

    if (!connected) {
      bindText(hint, i18n, 'send.notConnected');
      hint.hidden = false;
    } else if (!canSend && transport.kind === 'ble') {
      bindText(hint, i18n, 'send.noTarget');
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
    sendBtn.disabled = !canSend || !valid;
  };

  const send = async (): Promise<void> => {
    const transport = activeTransport(ctx);
    const result = payload();
    if (!result.ok || !transport.canSend()) {
      update();
      return;
    }
    sendBtn.disabled = true;
    const text = input.value;
    const ok = await ctx.session.send(transport, result.bytes);
    if (ok) {
      if (text && history[history.length - 1] !== text) {
        history.push(text);
        if (history.length > MAX_HISTORY) history.shift();
      }
      historyIndex = -1;
      draft = '';
      input.value = '';
    }
    update();
    input.focus();
  };

  sendBtn.addEventListener('click', () => void send());
  input.addEventListener('input', () => {
    historyIndex = -1;
    update();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) void send();
      return;
    }
    // History navigation (only for single-line content).
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !input.value.includes('\n')) {
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIndex === -1) draft = input.value;
      if (e.key === 'ArrowUp') {
        historyIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      } else if (historyIndex !== -1) {
        historyIndex = historyIndex + 1 >= history.length ? -1 : historyIndex + 1;
      }
      input.value = historyIndex === -1 ? draft : (history[historyIndex] ?? '');
      update();
    }
  });

  const refreshAll = (): void => {
    renderTargets();
    update();
  };
  let lastMode = settings.value.mode;
  settings.onChange((s) => {
    if (s.mode !== lastMode) {
      lastMode = s.mode;
      renderTargets();
    }
    update();
  });
  ctx.ble.on('state', refreshAll);
  ctx.ble.on('services', refreshAll);
  ctx.ble.on('txTarget', refreshAll);
  ctx.serial.on('state', update);
  refreshAll();
  return card;
}
