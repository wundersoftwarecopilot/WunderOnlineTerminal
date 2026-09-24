/**
 * Declarative DOM translation.
 *
 * Elements declare what they need through data attributes, so a language
 * change only requires calling `translateDom(root)` again:
 *
 * - `data-i18n="key"`               -> textContent
 * - `data-i18n-title="key"`         -> title attribute
 * - `data-i18n-placeholder="key"`   -> placeholder attribute
 * - `data-i18n-aria-label="key"`    -> aria-label attribute
 * - `data-i18n-params='{"n":1}'`    -> parameters shared by the keys above
 */
import type { I18n, MessageKey, MessageParams } from './i18n';

const ATTRIBUTE_TARGETS: Array<[string, string | null]> = [
  ['i18n', null],
  ['i18nTitle', 'title'],
  ['i18nPlaceholder', 'placeholder'],
  ['i18nAriaLabel', 'aria-label'],
];

function readParams(el: HTMLElement): MessageParams | undefined {
  const raw = el.dataset.i18nParams;
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MessageParams) : undefined;
  } catch {
    return undefined;
  }
}

export function translateElement(el: HTMLElement, i18n: I18n): void {
  const params = readParams(el);
  for (const [dataKey, attr] of ATTRIBUTE_TARGETS) {
    const key = el.dataset[dataKey];
    if (!key) continue;
    const text = i18n.t(key as MessageKey, params);
    if (attr) el.setAttribute(attr, text);
    else el.textContent = text;
  }
}

export function translateDom(root: ParentNode, i18n: I18n): void {
  const selector = '[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]';
  if (root instanceof HTMLElement && root.matches(selector)) translateElement(root, i18n);
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => translateElement(el, i18n));
}

/** Binds a key (and optional params) to an element and translates it now. */
export function bindText(
  el: HTMLElement,
  i18n: I18n,
  key: MessageKey,
  params?: MessageParams,
  attr: 'text' | 'title' | 'placeholder' | 'aria-label' = 'text',
): HTMLElement {
  const dataKey =
    attr === 'text'
      ? 'i18n'
      : attr === 'title'
        ? 'i18nTitle'
        : attr === 'placeholder'
          ? 'i18nPlaceholder'
          : 'i18nAriaLabel';
  el.dataset[dataKey] = key;
  if (params !== undefined) el.dataset.i18nParams = JSON.stringify(params);
  translateElement(el, i18n);
  return el;
}
