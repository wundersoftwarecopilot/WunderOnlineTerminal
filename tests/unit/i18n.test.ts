import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  I18n,
  LANGUAGE_NAMES,
  LOCALES,
  SUPPORTED_LANGUAGES,
  browserLanguages,
  detectLanguage,
  interpolate,
  resolveLanguage,
} from '../../src/i18n/i18n';
import { en } from '../../src/i18n/locales/en';
import { STORAGE_KEYS, createMemoryStorage } from '../../src/settings/storage';

describe('detectLanguage (automatic)', () => {
  it.each([
    ['it', 'it'],
    ['it-IT', 'it'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['es', 'es'],
    ['es-AR', 'es'],
    ['es-ES', 'es'],
    ['pt', 'pt'],
    ['pt-BR', 'pt'],
    ['pt-PT', 'pt'],
    ['fr', 'fr'],
    ['fr-FR', 'fr'],
    ['de', 'de'],
    ['de-DE', 'de'],
    ['DE-at', 'de'],
    ['pt_BR', 'pt'],
  ])('%s -> %s', (tag, expected) => {
    expect(detectLanguage([tag])).toBe(expected);
  });

  it('falls back to English for unsupported languages', () => {
    expect(detectLanguage(['ja-JP'])).toBe('en');
    expect(detectLanguage(['zh-CN', 'ru'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
    expect(detectLanguage(['', null, undefined])).toBe('en');
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('uses the first supported language of the preference list', () => {
    expect(detectLanguage(['ja-JP', 'fr-CA', 'it'])).toBe('fr');
  });

  it('reads navigator.languages then navigator.language', () => {
    expect(browserLanguages({ languages: ['de-DE', 'en'], language: 'de-DE' })).toEqual([
      'de-DE',
      'en',
    ]);
    expect(browserLanguages({ languages: [], language: 'es-AR' } as unknown as Navigator)).toEqual([
      'es-AR',
    ]);
  });
});

describe('resolveLanguage (manual choice has priority)', () => {
  it('prefers a valid stored choice over the browser language', () => {
    expect(resolveLanguage('de', ['it-IT'])).toBe('de');
  });
  it('ignores invalid stored values', () => {
    expect(resolveLanguage('xx', ['it-IT'])).toBe('it');
    expect(resolveLanguage(null, ['ko'])).toBe('en');
  });
});

describe('I18n', () => {
  it('detects the browser language when nothing is stored', () => {
    const i18n = new I18n(createMemoryStorage(), ['es-AR']);
    expect(i18n.language).toBe('es');
    expect(i18n.isManual).toBe(false);
    expect(i18n.t('conn.connect')).toBe('Conectar');
  });

  it('persists a manual choice and restores it on next load', () => {
    const storage = createMemoryStorage();
    const first = new I18n(storage, ['it-IT']);
    const changes: string[] = [];
    first.onChange((l) => changes.push(l));
    first.setLanguage('fr');
    expect(first.language).toBe('fr');
    expect(changes).toEqual(['fr']);
    expect(storage.get(STORAGE_KEYS.language)).toBe('fr');

    const second = new I18n(storage, ['it-IT']);
    expect(second.language).toBe('fr');
    expect(second.isManual).toBe(true);
  });

  it('interpolates parameters', () => {
    const i18n = new I18n(createMemoryStorage(), ['en']);
    expect(i18n.t('log.connected', { device: 'Sensor' })).toBe('Connected to Sensor.');
    expect(interpolate('{a} {b} {a}', { a: 1 })).toBe('1 {b} 1');
  });

  it('shows the required unsupported-browser message in English', () => {
    const i18n = new I18n(createMemoryStorage(), ['en-US']);
    expect(i18n.t('support.bleNoApi')).toBe('Web Bluetooth is not supported by this browser.');
  });
});

describe('locale files', () => {
  const keys = Object.keys(en).sort();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

  it('supports exactly it, en, es, pt, fr, de', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt']);
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt']);
  });

  for (const lang of SUPPORTED_LANGUAGES) {
    it(`${lang}: has every key, non-empty, with the same placeholders`, () => {
      const messages = LOCALES[lang] as Record<string, string>;
      expect(Object.keys(messages).sort()).toEqual(keys);
      for (const key of keys) {
        const value = messages[key]!;
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
        expect(placeholders(value), `${lang}.${key}`).toEqual(
          placeholders((en as Record<string, string>)[key]!),
        );
      }
    });
  }

  it('non-English locales are actually translated', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      if (lang === 'en') continue;
      const messages = LOCALES[lang] as Record<string, string>;
      const same = keys.filter((k) => messages[k] === (en as Record<string, string>)[k]);
      // Technical terms (RX, TX, HEX, BLE...) may legitimately be identical.
      expect(same.length / keys.length, lang).toBeLessThan(0.3);
    }
  });
});
