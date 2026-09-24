/**
 * Publisher / sponsor information shown in the page header.
 *
 * This is the ONLY place with publisher-specific content, and it is purely
 * presentational (logo and contact links). It has no connection with the
 * terminal, the transports or any device: removing or changing this file
 * does not affect the terminal in any way.
 *
 * Links are ordinary hyperlinks: nothing is contacted unless the user
 * clicks them. The logo is served from this site (public/brand/).
 */
export interface SocialLink {
  network: string;
  url: string;
  icon: 'facebook' | 'linkedin' | 'instagram' | 'youtube' | 'globe';
}

export interface PhoneNumber {
  /** Displayed text. */
  display: string;
  /** E.164 number used in the tel: link. */
  tel: string;
}

export interface BrandInfo {
  name: string;
  website: { url: string; label: string };
  /** Path relative to the page (file in `public/`). */
  logo: { src: string; alt: string; width: number; height: number };
  email: string;
  phones: PhoneNumber[];
  social: SocialLink[];
}

export const BRAND: BrandInfo = {
  name: 'Wunder',
  website: { url: 'https://www.wunder.it', label: 'www.wunder.it' },
  logo: { src: 'brand/logo.svg', alt: 'Wunder', width: 148, height: 40 },
  email: 'wunder@wunder.it',
  phones: [{ display: '+39 02 9096 4566', tel: '+390290964566' }],
  social: [
    { network: 'Facebook', url: 'https://www.facebook.com/WunderSaBisrl/', icon: 'facebook' },
    {
      network: 'LinkedIn',
      url: 'https://www.linkedin.com/company/wunder-sa.bi.-s.r.l./',
      icon: 'linkedin',
    },
  ],
};
