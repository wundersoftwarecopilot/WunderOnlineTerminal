/**
 * Top bar: publisher logo on the left, contacts on the right.
 * Purely presentational (see brand.ts).
 */
import type { I18n } from '../i18n/i18n';
import { bindText } from '../i18n/dom';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { BRAND, type BrandInfo } from './brand';

/** Attributes for links leaving the app: new tab, no referrer, no opener. */
const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function createBrandBar(i18n: I18n, brand: BrandInfo = BRAND): HTMLElement {
  const logo = h('img', {
    src: brand.logo.src,
    alt: brand.logo.alt,
    width: brand.logo.width,
    height: brand.logo.height,
    class: 'brand-logo',
    decoding: 'async',
  });
  const logoLink = h('a', { href: brand.website.url, class: 'brand-home', ...EXTERNAL }, logo);
  bindText(logoLink, i18n, 'brand.visitSite', { site: brand.website.label }, 'title');
  bindText(logoLink, i18n, 'brand.visitSite', { site: brand.website.label }, 'aria-label');

  const contacts = h('ul', { class: 'brand-contacts' });
  bindText(contacts, i18n, 'brand.contacts', {}, 'aria-label');

  const mail = h(
    'a',
    { href: `mailto:${brand.email}`, class: 'brand-link' },
    icon('mail', 16),
    h('span', { class: 'brand-link-text' }, brand.email),
  );
  bindText(mail, i18n, 'brand.email', { email: brand.email }, 'title');
  contacts.appendChild(h('li', {}, mail));

  for (const phone of brand.phones) {
    const a = h(
      'a',
      { href: `tel:${phone.tel}`, class: 'brand-link' },
      icon('phone', 16),
      h('span', { class: 'brand-link-text' }, phone.display),
    );
    bindText(a, i18n, 'brand.phone', { phone: phone.display }, 'title');
    contacts.appendChild(h('li', {}, a));
  }

  const site = h(
    'a',
    { href: brand.website.url, class: 'brand-link brand-site', ...EXTERNAL },
    icon('globe', 16),
    h('span', { class: 'brand-link-text' }, brand.website.label),
  );
  bindText(site, i18n, 'brand.visitSite', { site: brand.website.label }, 'title');
  contacts.appendChild(h('li', {}, site));

  for (const social of brand.social) {
    const a = h('a', { href: social.url, class: 'brand-link brand-social', ...EXTERNAL }, icon(social.icon, 16));
    bindText(a, i18n, 'brand.follow', { network: social.network }, 'title');
    bindText(a, i18n, 'brand.follow', { network: social.network }, 'aria-label');
    contacts.appendChild(h('li', {}, a));
  }

  return h(
    'div',
    { class: 'brand-bar' },
    h('div', { class: 'brand-bar-inner' }, logoLink, contacts),
  );
}
