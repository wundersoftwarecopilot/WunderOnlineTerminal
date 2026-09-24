import type { I18n, MessageKey } from '../i18n/i18n';
import { bindText } from '../i18n/dom';
import { h, nextId } from './dom';

/** Labeled form field. */
export function field(
  i18n: I18n,
  labelKey: MessageKey,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  hintKey?: MessageKey,
): HTMLElement {
  if (!control.id) control.id = nextId('f');
  const label = h('label', { for: control.id, class: 'field-label' });
  bindText(label, i18n, labelKey);
  const wrap = h('div', { class: 'field' }, label, control);
  if (hintKey) {
    const hint = h('p', { class: 'field-hint', id: `${control.id}-hint` });
    bindText(hint, i18n, hintKey);
    control.setAttribute('aria-describedby', hint.id);
    wrap.appendChild(hint);
  }
  return wrap;
}

/** Checkbox with label. */
export function checkbox(
  i18n: I18n,
  labelKey: MessageKey,
  checked: boolean,
  attrs: Record<string, string> = {},
): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox', ...attrs });
  input.checked = checked;
  const text = h('span', {});
  bindText(text, i18n, labelKey);
  const el = h('label', { class: 'check' }, input, text);
  return { el, input };
}

/** Sets translated labels on the options of a select. */
export function labelOptions(
  i18n: I18n,
  sel: HTMLSelectElement,
  keyOf: (value: string) => MessageKey | undefined,
): void {
  for (const option of Array.from(sel.options)) {
    const key = keyOf(option.value);
    if (key) bindText(option, i18n, key);
  }
}

/** Segmented button group behaving like radio buttons. */
export function segmented<T extends string>(
  i18n: I18n,
  labelKey: MessageKey,
  items: ReadonlyArray<{ value: T; key: MessageKey }>,
  current: T,
  onSelect: (value: T) => void,
  testId?: string,
): { el: HTMLElement; set: (value: T) => void } {
  const group = h('div', { class: 'segmented', role: 'radiogroup' });
  if (testId) group.dataset.testid = testId;
  bindText(group, i18n, labelKey, {}, 'aria-label');
  const buttons = items.map((item) => {
    const b = h('button', { type: 'button', role: 'radio', 'data-value': item.value });
    bindText(b, i18n, item.key);
    b.addEventListener('click', () => onSelect(item.value));
    group.appendChild(b);
    return b;
  });
  const set = (value: T): void => {
    buttons.forEach((b) => {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = buttons[(idx + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    if (next) {
      onSelect(next.dataset.value as T);
      next.focus();
    }
    e.preventDefault();
  });
  set(current);
  return { el: group, set };
}
