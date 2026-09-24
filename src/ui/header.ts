import { bindText } from '../i18n/dom';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, isLanguage } from '../i18n/i18n';
import type { AppContext } from './context';
import { h, nextId } from './dom';
import { icon } from './icons';

/** Application title bar with the manual language selector. */
export function createAppHeader(ctx: AppContext): HTMLElement {
  const { i18n } = ctx;
  const title = h('h1', { class: 'app-title' });
  bindText(title, i18n, 'app.title');
  const subtitle = h('p', { class: 'app-subtitle' });
  bindText(subtitle, i18n, 'app.subtitle');

  const id = nextId('lang');
  const label = h('label', { for: id, class: 'visually-hidden' });
  bindText(label, i18n, 'lang.label');
  const select = h('select', { id, class: 'lang-select' });
  for (const lang of SUPPORTED_LANGUAGES) {
    const option = h('option', { value: lang, lang }, LANGUAGE_NAMES[lang]);
    option.selected = lang === i18n.language;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    if (isLanguage(select.value)) i18n.setLanguage(select.value);
  });
  i18n.onChange((lang) => {
    select.value = lang;
  });

  return h(
    'header',
    { class: 'app-header' },
    h(
      'div',
      { class: 'app-header-inner' },
      h('div', { class: 'app-heading' }, title, subtitle),
      h('div', { class: 'lang-picker' }, icon('lang', 16), label, select),
    ),
  );
}
