// Language state for code outside React (formatters, notices, error text). Components use useT().

import { de } from './de';
import { en, type Messages } from './en';

export type Language = 'en' | 'de';
export type { Messages };

export const LANGUAGES: Record<Language, { messages: Messages; locale: string; path: string }> = {
  en: { messages: en, locale: 'en-US', path: '' },
  de: { messages: de, locale: 'de-DE', path: 'de/' },
};

let current: Language = 'en';

/** Called on every render of the app shell, so formatters called during render use the right locale. */
export const setLanguage = (language: Language): void => {
  current = language;
  if (typeof document !== 'undefined' && document.documentElement.lang !== language) document.documentElement.lang = language;
};

export const getLanguage = (): Language => current;
export const messages = (): Messages => LANGUAGES[current].messages;
export const isGerman = (): boolean => current === 'de';

const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'de';

/** The language in the URL (`…/localcrop/de/`), if any. */
export const languageFromPath = (pathname: string, base: string): Language | null => {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return rest === 'de' || rest.startsWith('de/') ? 'de' : null;
};

/** Path wins (shared /de/ links), then the saved choice, then the browser's language. */
export const initialLanguage = (saved: unknown): Language => {
  if (typeof window === 'undefined') return 'en';
  const fromPath = languageFromPath(window.location.pathname, import.meta.env.BASE_URL);
  if (fromPath) return fromPath;
  if (isLanguage(saved)) return saved;
  return navigator.languages?.some((tag) => tag.toLowerCase().startsWith('de')) ? 'de' : 'en';
};

/** Keeps the URL in step with the language (/localcrop/ ↔ /localcrop/de/), without reloading. */
export const syncLanguagePath = (language: Language): void => {
  const base = import.meta.env.BASE_URL;
  const { pathname, search, hash } = window.location;
  if ((languageFromPath(pathname, base) ?? 'en') === language) return;
  window.history.replaceState(window.history.state, '', `${base}${LANGUAGES[language].path}${search}${hash}`);
};

// Messages with values in them, thrown in English by decoders and workers.
const PATTERNS: [RegExp, (match: RegExpExecArray) => string][] = [
  [/^(.+) files aren’t supported\. Export a JPEG, PNG or TIFF first\.$/, (m) => `${m[1]}-Dateien werden nicht unterstützt. Exportiere zuerst ein JPEG, PNG oder TIFF.`],
  [/^Unsupported format\. Supported: (.+)\.$/, (m) => `Nicht unterstütztes Format. Unterstützt: ${m[1]}.`],
  [/^Couldn’t decode this HEIC image: (.+)$/, (m) => `Dieses HEIC-Bild konnte nicht dekodiert werden: ${translateError(m[1] ?? '')}`],
  [/^Couldn’t read this PDF: (.+)$/, (m) => `Diese PDF konnte nicht gelesen werden: ${translateError(m[1] ?? '')}`],
  [/^Couldn’t render this PDF: (.+)$/, (m) => `Diese PDF konnte nicht gerendert werden: ${translateError(m[1] ?? '')}`],
  [/^The server answered (.+?)\.?$/, (m) => `Der Server antwortete mit ${m[1]}.`],
  [/^That URL returned (.+), not an image\.$/, (m) => `Diese URL liefert ${m[1]}, kein Bild.`],
  [/^TIFF compression (\d+) isn’t supported\.$/, (m) => `TIFF-Kompression ${m[1]} wird nicht unterstützt.`],
  [/^(\d+)-bit TIFF samples aren’t supported\.$/, (m) => `${m[1]}-Bit-TIFFs werden nicht unterstützt.`],
  [/^TIFF color type (\d+) isn’t supported\.$/, (m) => `TIFF-Farbtyp ${m[1]} wird nicht unterstützt.`],
  [/^(.+) is password-protected, which isn’t supported\.$/, (m) => `${m[1]} ist passwortgeschützt, das wird nicht unterstützt.`],
  [/^(.+) uses a compression method \((\d+)\) that isn’t supported\.$/, (m) => `${m[1]} nutzt eine nicht unterstützte Kompression (${m[2]}).`],
  [/^This file was made by a newer version of the app \(schema (\d+)\)\.$/, (m) => `Diese Datei stammt aus einer neueren App-Version (Schema ${m[1]}).`],
  [/^Download failed \((\d+)\) for (.+)\.$/, (m) => `Download fehlgeschlagen (${m[1]}) für ${m[2]}.`],
];

/** Translates an English error message from lower layers when the UI is in German. */
export const translateError = (message: string): string => {
  if (current === 'en') return message;
  const exact = messages().errors[message];
  if (exact) return exact;
  for (const [pattern, render] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) return render(match);
  }
  return message;
};

/** Error → user-facing text in the current language. */
export const errorText = (error: unknown): string => translateError(error instanceof Error ? error.message : String(error));

/** Display name for a preset: built-ins are translated, user presets keep their own name. */
export const presetLabel = (preset: { id: string; name: string }): string => {
  const key = preset.id.startsWith('builtin:') ? preset.id.slice('builtin:'.length) : null;
  return (key && messages().presets.builtin[key]) || preset.name;
};
