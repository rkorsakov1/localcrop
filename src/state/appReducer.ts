import { adaptCropToAspect, computeAutoCrop, IDENTITY_TRANSFORM, targetAspect, transformedSize } from '../lib/cropMath';
import { BUILTIN_PRESETS, effectiveOverrides, findPreset, isBuiltinPreset, orderedPresets, resolvePreset, uniquePresetName } from '../lib/presets';
import type { CropRect, Cutout, EncodedOutput, Preset, QueueItem, Transform } from '../lib/types';
import type { Language } from '../i18n';
import type { FillMethod } from '../worker/protocol';
import { EMPTY_HISTORY, type History } from './history';

export type Mode = 'crop' | 'retouch' | 'background' | 'compare';

export type Theme = 'system' | 'light' | 'dark';

/** `lifetime`: bytes saved and images exported across all sessions in this browser. `fillMethod`: the last retouch fill used. */
export type Prefs = {
  showThirds: boolean;
  theme: Theme;
  language: Language;
  lifetime: { bytes: number; count: number };
  fillMethod: FillMethod;
};

export type Notice = {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
  action?: { label: string; run: () => void };
  /** An "Undo" toast: dismissed once that step is undone. */
  undoesStep?: boolean;
  /** Stays until dismissed (errors always do). */
  persistent?: boolean;
};

export type AppState = {
  /** User presets. Built-ins live in BUILTIN_PRESETS. */
  presets: Preset[];
  /** Display order of built-in and user presets together (ids); see orderedPresets. */
  presetOrder: string[];
  /** Preset given to newly added images; the last one the user picked. */
  lastPresetId: string;
  items: QueueItem[];
  selectedId: string | null;
  mode: Mode;
  prefs: Prefs;
  savings: { bytes: number; count: number };
  notices: Notice[];
  /** Text for the aria-live region. */
  announcement: string;
  history: History;
};

export type NewItem = Pick<QueueItem, 'id' | 'sourceName' | 'sourceBytes' | 'sourceType' | 'sourceBitmap'>;

export type AppAction =
  | { type: 'addItems'; items: NewItem[] }
  | { type: 'removeItem'; id: string }
  | { type: 'renameItem'; id: string; name: string }
  | { type: 'selectItem'; id: string }
  | { type: 'selectRelative'; offset: 1 | -1 }
  | { type: 'setMode'; mode: Mode }
  | { type: 'setCrop'; id: string; crop: CropRect | null; gesture?: string }
  | { type: 'setTransform'; id: string; transform: Transform }
  | { type: 'setItemPreset'; id: string; presetId: string }
  | { type: 'applyPresetToAll'; presetId: string }
  | { type: 'setOverrides'; id: string; patch: Partial<Preset>; gesture?: string }
  | { type: 'resetOverrides'; id: string }
  | { type: 'saveOverridesToPreset'; id: string }
  | { type: 'saveOverridesAsNewPreset'; id: string; name: string; newPresetId: string }
  /** Replaces the retouched image (null = back to the source) and the refinable cut-out, if any. */
  | { type: 'setEdit'; id: string; bitmap: ImageBitmap | null; cutout: Cutout | null; mergeKey?: string }
  | { type: 'encodeStarted'; id: string; revision: number }
  | { type: 'encodeFinished'; id: string; revision: number; output: EncodedOutput }
  | { type: 'encodeFailed'; id: string; revision: number; error: string }
  | { type: 'encodeCancelled'; id: string; revision: number }
  | { type: 'upsertPreset'; preset: Preset }
  | { type: 'deletePreset'; id: string }
  /** Moves a preset to `index` in the combined (built-in + user) list. */
  | { type: 'movePreset'; id: string; index: number }
  | { type: 'replacePresets'; presets: Preset[] }
  | { type: 'setPref'; patch: Partial<Prefs> }
  | { type: 'addSavings'; before: number; after: number; count: number }
  | { type: 'notify'; notice: Notice }
  | { type: 'dismissNotice'; id: string }
  | { type: 'announce'; message: string };

export const DEFAULT_PRESET_ID = (BUILTIN_PRESETS[0] as Preset).id;

export const createInitialState = (persisted: { presets: Preset[]; presetOrder: string[]; lastPresetId: string; prefs: Prefs }): AppState => ({
  presets: persisted.presets,
  presetOrder: persisted.presetOrder,
  lastPresetId: persisted.lastPresetId,
  items: [],
  selectedId: null,
  mode: 'crop',
  prefs: persisted.prefs,
  savings: { bytes: 0, count: 0 },
  notices: [],
  announcement: '',
  history: EMPTY_HISTORY,
});

/** Fields whose change invalidates a manual crop (aspect or crop semantics change). */
const CROP_AFFECTING: (keyof Preset)[] = ['width', 'height', 'fit'];

const updateItem = (state: AppState, id: string, update: (item: QueueItem) => QueueItem): AppState => ({
  ...state,
  items: state.items.map((item) => (item.id === id ? update(item) : item)),
});

/** Marks the item's output stale. */
const bump = (item: QueueItem): QueueItem => ({ ...item, revision: item.revision + 1, status: 'idle', error: null });

const aspectChanged = (before: Preset, after: Preset): boolean =>
  CROP_AFFECTING.some((key) => before[key] !== after[key]);

/** Contain mode shows the whole image; every other mode uses the crop. */
const usesCrop = (preset: Preset): boolean => !(preset.fit === 'contain' && preset.width !== null && preset.height !== null);

/**
 * The item's crop after its settings change from `before` to `after`. The selection stays where
 * it is: unlinking W × H keeps the current box, and a new ratio reshapes it around its center.
 * An automatic (never adjusted) crop stays automatic when the new settings would center it anyway.
 */
export const cropAfterSettingsChange = (item: QueueItem, before: Preset, after: Preset): CropRect | null => {
  if (!aspectChanged(before, after) || !usesCrop(after)) return item.crop;
  const image = transformedSize(item.editedBitmap ?? item.sourceBitmap, item.transform.rotation);
  const beforeAspect = usesCrop(before) ? targetAspect(before) : null;
  const afterAspect = targetAspect(after);
  if (afterAspect === null) {
    // Free or one-sided size: keep what was on screen, unless that was the whole image anyway.
    if (item.crop || !usesCrop(before) || beforeAspect === null) return item.crop;
    return computeAutoCrop(image, beforeAspect);
  }
  if (beforeAspect !== null && Math.abs(beforeAspect - afterAspect) < 1e-9) return item.crop;
  return item.crop ? adaptCropToAspect(item.crop, afterAspect, image) : null;
};

export const getItemPreset = (state: Pick<AppState, 'presets'>, item: QueueItem): Preset =>
  resolvePreset(findPreset(state.presets, item.presetId), item.overrides);

export const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'addItems': {
      if (action.items.length === 0) return state;
      const presetId = findPreset(state.presets, state.lastPresetId).id;
      const added: QueueItem[] = action.items.map((item) => ({
        ...item,
        editedBitmap: null,
        cutout: null,
        transform: IDENTITY_TRANSFORM,
        crop: null,
        presetId,
        overrides: {},
        status: 'idle',
        output: null,
        error: null,
        revision: 1,
        outputRevision: 0,
      }));
      const firstAdded = added[0] as QueueItem;
      return {
        ...state,
        items: [...state.items, ...added],
        selectedId: state.selectedId ?? firstAdded.id,
      };
    }

    case 'removeItem': {
      const index = state.items.findIndex((item) => item.id === action.id);
      if (index === -1) return state;
      const items = state.items.filter((item) => item.id !== action.id);
      let selectedId = state.selectedId;
      if (selectedId === action.id) {
        const neighbour = items[Math.min(index, items.length - 1)];
        selectedId = neighbour ? neighbour.id : null;
      }
      return { ...state, items, selectedId };
    }

    case 'renameItem': {
      const name = action.name.trim();
      if (!name) return state;
      // The name feeds {name} in the filename template; the output itself is unchanged.
      return updateItem(state, action.id, (item) => (item.sourceName === name ? item : { ...item, sourceName: name }));
    }

    case 'selectItem':
      return { ...state, selectedId: action.id };

    case 'selectRelative': {
      if (state.items.length === 0) return state;
      const index = state.items.findIndex((item) => item.id === state.selectedId);
      const next = (index + action.offset + state.items.length) % state.items.length;
      return { ...state, selectedId: (state.items[next] as QueueItem).id };
    }

    case 'setMode':
      return { ...state, mode: action.mode };

    case 'setCrop':
      return updateItem(state, action.id, (item) => bump({ ...item, crop: action.crop }));

    case 'setTransform':
      return updateItem(state, action.id, (item) => bump({ ...item, transform: action.transform, crop: null }));

    case 'setItemPreset': {
      const after = findPreset(state.presets, action.presetId);
      const next = updateItem(state, action.id, (item) =>
        bump({ ...item, presetId: action.presetId, overrides: {}, crop: cropAfterSettingsChange(item, getItemPreset(state, item), after) }),
      );
      return { ...next, lastPresetId: action.presetId };
    }

    case 'applyPresetToAll':
      return {
        ...state,
        lastPresetId: action.presetId,
        items: state.items.map((item) =>
          bump({ ...item, presetId: action.presetId, overrides: {}, crop: cropAfterSettingsChange(item, getItemPreset(state, item), findPreset(state.presets, action.presetId)) }),
        ),
      };

    case 'setOverrides':
      return updateItem(state, action.id, (item) => {
        const before = getItemPreset(state, item);
        const base = findPreset(state.presets, item.presetId);
        const overrides = effectiveOverrides(base, { ...item.overrides, ...action.patch });
        const after = resolvePreset(base, overrides);
        return bump({ ...item, overrides, crop: cropAfterSettingsChange(item, before, after) });
      });

    case 'resetOverrides':
      return updateItem(state, action.id, (item) => {
        const before = getItemPreset(state, item);
        const after = findPreset(state.presets, item.presetId);
        return bump({ ...item, overrides: {}, crop: cropAfterSettingsChange(item, before, after) });
      });

    case 'saveOverridesToPreset': {
      const item = state.items.find((candidate) => candidate.id === action.id);
      if (!item || isBuiltinPreset(item.presetId)) return state;
      const resolved = getItemPreset(state, item);
      const next = { ...state, presets: state.presets.map((preset) => (preset.id === resolved.id ? resolved : preset)) };
      return {
        ...next,
        items: state.items.map((candidate) => {
          if (candidate.id === item.id) return { ...candidate, overrides: {} };
          if (candidate.presetId !== item.presetId) return candidate;
          // Other images on this preset pick up the saved settings.
          const updated = { ...candidate, crop: cropAfterSettingsChange(candidate, getItemPreset(state, candidate), getItemPreset(next, candidate)) };
          return bump(updated);
        }),
      };
    }

    case 'saveOverridesAsNewPreset': {
      const item = state.items.find((candidate) => candidate.id === action.id);
      if (!item) return state;
      const resolved = getItemPreset(state, item);
      const preset: Preset = {
        ...resolved,
        id: action.newPresetId,
        name: uniquePresetName(action.name.trim() || resolved.name, [...BUILTIN_PRESETS, ...state.presets]),
      };
      return {
        ...state,
        presets: [...state.presets, preset],
        lastPresetId: preset.id,
        items: state.items.map((candidate) =>
          candidate.id === item.id ? { ...candidate, presetId: preset.id, overrides: {} } : candidate,
        ),
      };
    }

    case 'setEdit':
      return updateItem(state, action.id, (item) => bump({ ...item, editedBitmap: action.bitmap, cutout: action.cutout }));

    case 'encodeStarted':
      return updateItem(state, action.id, (item) =>
        item.revision === action.revision ? { ...item, status: 'encoding', error: null } : item,
      );

    case 'encodeFinished':
      return updateItem(state, action.id, (item) => {
        if (item.revision !== action.revision) return item;
        return { ...item, status: 'ready', output: action.output, outputRevision: action.revision, error: null };
      });

    case 'encodeFailed':
      return updateItem(state, action.id, (item) =>
        item.revision === action.revision ? { ...item, status: 'error', error: action.error } : item,
      );

    case 'encodeCancelled':
      return updateItem(state, action.id, (item) =>
        item.revision === action.revision && item.status === 'encoding' ? { ...item, status: 'idle' } : item,
      );

    case 'upsertPreset': {
      const exists = state.presets.some((preset) => preset.id === action.preset.id);
      const presets = exists
        ? state.presets.map((preset) => (preset.id === action.preset.id ? action.preset : preset))
        : [...state.presets, action.preset];
      const next = { ...state, presets };
      return {
        ...next,
        // Other images using this preset keep their selection, reshaped if the ratio changed.
        items: state.items.map((item) =>
          item.presetId === action.preset.id ? bump({ ...item, crop: cropAfterSettingsChange(item, getItemPreset(state, item), getItemPreset(next, item)) }) : item,
        ),
      };
    }

    case 'deletePreset': {
      const presets = state.presets.filter((preset) => preset.id !== action.id);
      return {
        ...state,
        presets,
        lastPresetId: state.lastPresetId === action.id ? DEFAULT_PRESET_ID : state.lastPresetId,
        items: state.items.map((item) =>
          item.presetId === action.id
            ? bump({ ...item, presetId: DEFAULT_PRESET_ID, overrides: {}, crop: cropAfterSettingsChange(item, getItemPreset(state, item), findPreset(presets, DEFAULT_PRESET_ID)) })
            : item,
        ),
      };
    }

    case 'movePreset': {
      const ids = orderedPresets(state.presets, state.presetOrder).map((preset) => preset.id);
      const from = ids.indexOf(action.id);
      const to = Math.min(ids.length - 1, Math.max(0, action.index));
      if (from === -1 || from === to) return state;
      ids.splice(from, 1);
      ids.splice(to, 0, action.id);
      return { ...state, presetOrder: ids };
    }

    case 'replacePresets':
      return { ...state, presets: action.presets };

    case 'setPref':
      return { ...state, prefs: { ...state.prefs, ...action.patch } };

    case 'addSavings': {
      const saved = Math.max(0, action.before - action.after);
      return {
        ...state,
        savings: { bytes: state.savings.bytes + saved, count: state.savings.count + action.count },
        prefs: { ...state.prefs, lifetime: { bytes: state.prefs.lifetime.bytes + saved, count: state.prefs.lifetime.count + action.count } },
      };
    }

    case 'notify':
      return { ...state, notices: [...state.notices.slice(-4), action.notice], announcement: action.notice.message };

    case 'dismissNotice':
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) };

    case 'announce':
      return { ...state, announcement: action.message };
  }
};
