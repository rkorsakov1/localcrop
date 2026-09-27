import { DEFAULT_FILENAME_TEMPLATE } from './filenameTemplate';
import { isBuiltinPreset, uniquePresetName } from './presets';
import { messages } from '../i18n';
import type { FitMode, OutputFormat, Preset, PresetFile } from './types';

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_DIMENSION = 16384;
const MAX_NAME_LENGTH = 80;
const MAX_TEMPLATE_LENGTH = 200;

const FORMATS: readonly OutputFormat[] = ['jpeg', 'webp', 'avif', 'png', 'pdf'];
const FITS: readonly FitMode[] = ['cover', 'contain', 'free'];

export type PresetValidation =
  | { ok: true; preset: Preset; repairs: string[] }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const newId = (): string => crypto.randomUUID();

const normalizeHex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  return null;
};

const validateDimension = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > MAX_DIMENSION) return undefined;
  return rounded;
};

/**
 * Checks every field of an unknown value that should be a Preset.
 * Missing or invalid fields are repaired with safe defaults (and listed in `repairs`);
 * values that aren't objects, or have no usable name *and* format, are rejected.
 */
export const validatePreset = (raw: unknown): PresetValidation => {
  if (!isRecord(raw)) return { ok: false, reason: 'not an object' };
  const repairs: string[] = [];

  const hasName = typeof raw.name === 'string' && raw.name.trim().length > 0;
  const hasFormat = FORMATS.includes(raw.format as OutputFormat);
  if (!hasName && !hasFormat) return { ok: false, reason: 'missing name and format' };

  const id = typeof raw.id === 'string' && raw.id.trim().length > 0 && !isBuiltinPreset(raw.id) ? raw.id : newId();
  if (id !== raw.id) repairs.push('id');

  const name = hasName ? (raw.name as string).trim().slice(0, MAX_NAME_LENGTH) : 'Untitled preset';
  if (name !== raw.name) repairs.push('name');

  const width = validateDimension(raw.width);
  if (width === undefined) repairs.push('width');
  const height = validateDimension(raw.height);
  if (height === undefined) repairs.push('height');

  const fit = FITS.includes(raw.fit as FitMode) ? (raw.fit as FitMode) : 'cover';
  if (fit !== raw.fit) repairs.push('fit');

  const format = hasFormat ? (raw.format as OutputFormat) : 'jpeg';
  if (!hasFormat) repairs.push('format');

  const quality =
    typeof raw.quality === 'number' && Number.isFinite(raw.quality) ? Math.min(100, Math.max(0, Math.round(raw.quality))) : 80;
  if (quality !== raw.quality) repairs.push('quality');

  let targetMaxBytes: number | null = null;
  if (typeof raw.targetMaxBytes === 'number' && Number.isFinite(raw.targetMaxBytes) && raw.targetMaxBytes > 0) {
    targetMaxBytes = Math.round(raw.targetMaxBytes);
  }
  if (targetMaxBytes !== raw.targetMaxBytes) repairs.push('targetMaxBytes');

  const matteColor = normalizeHex(raw.matteColor) ?? '#ffffff';
  if (matteColor !== raw.matteColor) repairs.push('matteColor');

  const allowUpscale = typeof raw.allowUpscale === 'boolean' ? raw.allowUpscale : false;
  if (allowUpscale !== raw.allowUpscale) repairs.push('allowUpscale');

  const templateValid =
    typeof raw.filenameTemplate === 'string' &&
    raw.filenameTemplate.trim().length > 0 &&
    raw.filenameTemplate.length <= MAX_TEMPLATE_LENGTH;
  const filenameTemplate = templateValid ? (raw.filenameTemplate as string) : DEFAULT_FILENAME_TEMPLATE;
  if (!templateValid) repairs.push('filenameTemplate');

  const sharpen =
    typeof raw.sharpen === 'number' && Number.isFinite(raw.sharpen) ? Math.min(100, Math.max(0, Math.round(raw.sharpen))) : 0;
  if (sharpen !== raw.sharpen) repairs.push('sharpen');

  return {
    ok: true,
    preset: {
      id,
      name,
      width: width ?? null,
      height: height ?? null,
      fit,
      format,
      quality,
      targetMaxBytes,
      matteColor,
      allowUpscale,
      filenameTemplate,
      sharpen,
    },
    repairs,
  };
};

/**
 * Upgrades a parsed preset file from `schemaVersion` to the current version.
 * Only v1 exists; future versions add a step here (v1 → v2 → …).
 */
export const migrate = (schemaVersion: number, data: Record<string, unknown>): Record<string, unknown> => {
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`This file was made by a newer version of the app (schema ${schemaVersion}).`);
  }
  if (schemaVersion < 1) throw new Error(`Unknown schema version ${schemaVersion}.`);
  return data;
};

export type PresetFileValidation =
  | { ok: true; presets: Preset[]; rejected: number; repaired: number }
  | { ok: false; reason: string };

/** Validates a parsed JSON value that should be a PresetFile (used for both imports and localStorage). */
export const validatePresetFile = (raw: unknown): PresetFileValidation => {
  if (!isRecord(raw)) return { ok: false, reason: 'Not a preset file.' };
  if (raw.app !== 'localcrop') return { ok: false, reason: 'Not a LocalCrop preset file.' };
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion)) {
    return { ok: false, reason: 'Missing schema version.' };
  }

  let data: Record<string, unknown>;
  try {
    data = migrate(raw.schemaVersion, raw);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  if (!Array.isArray(data.presets)) return { ok: false, reason: 'The file has no preset list.' };

  const presets: Preset[] = [];
  let rejected = 0;
  let repaired = 0;
  for (const entry of data.presets) {
    const result = validatePreset(entry);
    if (!result.ok) {
      rejected += 1;
      continue;
    }
    if (result.repairs.length > 0) repaired += 1;
    presets.push(result.preset);
  }
  return { ok: true, presets, rejected, repaired };
};

export const createPresetFile = (presets: readonly Preset[]): PresetFile => ({
  app: 'localcrop',
  schemaVersion: 1,
  presets: presets.map((preset) => ({ ...preset })),
});

export type MergeSummary = { added: number; renamed: number; unchanged: number };

const samePresetContent = (a: Preset, b: Preset): boolean =>
  (Object.keys(a) as (keyof Preset)[]).every((key) => a[key] === b[key]);

/**
 * Merges imported presets into the existing list. Identical presets (same id and content)
 * are skipped; an id collision with different content gets a new id; name conflicts are
 * renamed "Name (2)".
 */
export const mergePresets = (
  existing: readonly Preset[],
  incoming: readonly Preset[],
): { presets: Preset[]; summary: MergeSummary } => {
  const result = [...existing];
  const summary: MergeSummary = { added: 0, renamed: 0, unchanged: 0 };

  for (const preset of incoming) {
    const sameId = result.find((candidate) => candidate.id === preset.id);
    if (sameId && samePresetContent(sameId, preset)) {
      summary.unchanged += 1;
      continue;
    }
    const id = sameId ? newId() : preset.id;
    const name = uniquePresetName(preset.name, result);
    if (name !== preset.name) summary.renamed += 1;
    result.push({ ...preset, id, name });
    summary.added += 1;
  }

  return { presets: result, summary };
};

/** "2 new, 1 name conflict → renamed", in the current UI language. */
export const describeMergeSummary = (summary: MergeSummary, rejected: number): string =>
  messages().presets.merged(summary.added, summary.renamed, summary.unchanged, rejected);
