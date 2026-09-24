/**
 * Internationalization: language detection, persistence and translation.
 */
import { Emitter } from '../core/emitter';
import { STORAGE_KEYS, type KeyValueStorage } from '../settings/storage';
import { de } from './locales/de';
import { en, type MessageKey, type Messages } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { pt } from './locales/pt';

export type { MessageKey, Messages };

export const SUPPORTED_LANGUAGES = ['it', 'en', 'es', 'pt', 'fr', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Native language names for the selector (never translated). */
export const LANGUAGE_NAMES: Record<Language, string> = {
  it: 'Italiano',
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  de: 'Deutsch',
};

export const LOCALES: Record<Language, Messages> = { it, en, es, pt, fr, de };

export type MessageParams = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** `it-IT` -> `it`, `pt_BR` -> `pt`, `EN` -> `en`. */
export function primarySubtag(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Picks the first supported language from the browser preference list
 * (`navigator.languages`, then `navigator.language`). Falls back to English.
 */
export function detectLanguage(preferred: readonly (string | null | undefined)[] | undefined): Language {
  for (const tag of preferred ?? []) {
    if (!tag) continue;
    const primary = primarySubtag(tag);
    if (isLanguage(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

/** Browser language preferences, most preferred first. */
export function browserLanguages(nav: Pick<Navigator, 'language' | 'languages'> | undefined =
  typeof navigator !== 'undefined' ? navigator : undefined): string[] {
  if (!nav) return [];
  const list = Array.isArray(nav.languages) ? [...nav.languages] : [];
  if (nav.language && !list.includes(nav.language)) list.push(nav.language);
  return list;
}

/**
 * The language to use: a valid manual choice saved by the user wins over
 * the browser preferences.
 */
export function resolveLanguage(
  stored: string | null | undefined,
  preferred: readonly string[] | undefined,
): Language {
  if (isLanguage(stored)) return stored;
  return detectLanguage(preferred);
}

/** Replaces `{name}` placeholders. Unknown placeholders are kept as-is. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

interface I18nEvents extends Record<string, unknown> {
  change: Language;
}

export class I18n {
  private readonly emitter = new Emitter<I18nEvents>();
  private lang: Language;

  constructor(
    private readonly storage: KeyValueStorage,
    preferred: readonly string[] = browserLanguages(),
  ) {
    this.lang = resolveLanguage(storage.get(STORAGE_KEYS.language), preferred);
  }

  get language(): Language {
    return this.lang;
  }

  /** True when the current language comes from a saved manual choice. */
  get isManual(): boolean {
    return isLanguage(this.storage.get(STORAGE_KEYS.language));
  }

  t(key: MessageKey, params?: MessageParams): string {
    const template = LOCALES[this.lang][key] ?? en[key] ?? key;
    return interpolate(template, params);
  }

  /** Manual selection: persisted and applied immediately. */
  setLanguage(lang: Language): void {
    if (!isLanguage(lang)) return;
    this.storage.set(STORAGE_KEYS.language, lang);
    if (lang === this.lang) return;
    this.lang = lang;
    this.emitter.emit('change', lang);
  }

  onChange(listener: (lang: Language) => void): () => void {
    return this.emitter.on('change', listener);
  }
}
