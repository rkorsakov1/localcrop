import { BUILTIN_PRESETS, findPreset } from '../lib/presets';
import { createPresetFile, validatePresetFile } from '../lib/presetValidation';
import { initialLanguage } from '../i18n';
import type { Preset } from '../lib/types';
import { DEFAULT_PRESET_ID, type Prefs } from './appReducer';

export const STORAGE_KEY = 'localcrop:presets:v1';

export type PersistedState = { presets: Preset[]; presetOrder: string[]; lastPresetId: string; prefs: Prefs };

const DEFAULT_PREFS: Prefs = { showThirds: true, theme: 'system', language: 'en', lifetime: { bytes: 0, count: 0 }, fillMethod: 'flat' };

const readLifetime = (raw: unknown): Prefs['lifetime'] => {
  if (typeof raw !== 'object' || raw === null) return { bytes: 0, count: 0 };
  const { bytes, count } = raw as Record<string, unknown>;
  const valid = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
  return { bytes: valid(bytes), count: valid(count) };
};

const readPrefs = (raw: unknown): Prefs => {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS, language: initialLanguage(null) };
  const record = raw as Record<string, unknown>;
  return {
    showThirds: typeof record.showThirds === 'boolean' ? record.showThirds : DEFAULT_PREFS.showThirds,
    theme: record.theme === 'light' || record.theme === 'dark' ? record.theme : 'system',
    language: initialLanguage(record.language),
    lifetime: readLifetime(record.lifetime),
    fillMethod: record.fillMethod === 'smooth' ? 'smooth' : 'flat',
  };
};

/** Loads presets and UI preferences, repairing or dropping anything invalid. */
export const loadPersistedState = (): PersistedState => {
  const fallback: PersistedState = { presets: [], presetOrder: [], lastPresetId: DEFAULT_PRESET_ID, prefs: { ...DEFAULT_PREFS, language: initialLanguage(null) } };
  let text: string | null = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!text) return fallback;

  try {
    const parsed: unknown = JSON.parse(text);
    const validation = validatePresetFile(parsed);
    if (!validation.ok) return fallback;
    const record = parsed as Record<string, unknown>;
    const presets = validation.presets;
    const lastPresetId =
      typeof record.lastPresetId === 'string' ? findPreset(presets, record.lastPresetId).id : DEFAULT_PRESET_ID;
    const presetOrder = Array.isArray(record.presetOrder) ? record.presetOrder.filter((id): id is string => typeof id === 'string') : [];
    return { presets, presetOrder, lastPresetId, prefs: readPrefs(record.prefs) };
  } catch {
    return fallback;
  }
};

export const savePersistedState = (state: PersistedState): boolean => {
  try {
    const file = createPresetFile(state.presets);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...file, presetOrder: state.presetOrder, lastPresetId: state.lastPresetId, prefs: state.prefs }));
    return true;
  } catch {
    return false;
  }
};

export const allPresets = (userPresets: readonly Preset[]): Preset[] => [...BUILTIN_PRESETS, ...userPresets];
