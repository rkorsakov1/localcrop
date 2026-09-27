import { useEffect } from 'react';
import { isTextEntryTarget } from '../hooks/useKeyboardShortcuts';
import type { Preset, QueueItem } from '../lib/types';
import { messages } from '../i18n';
import type { AppAction, AppState } from './appReducer';

/** The parts of an image that editing changes. Outputs and encode status are derived and not kept. */
type ItemDoc = Pick<
  QueueItem,
  'id' | 'sourceName' | 'sourceBytes' | 'sourceType' | 'sourceDpi' | 'sourceBitmap' | 'editedBitmap' | 'cutout' | 'transform' | 'crop' | 'presetId' | 'overrides'
>;

export type Snapshot = { items: ItemDoc[]; presets: Preset[]; presetOrder: string[]; lastPresetId: string; selectedId: string | null };

export type History = {
  past: Snapshot[];
  future: Snapshot[];
  /** Consecutive actions with the same key (e.g. one crop drag) become a single undo step. */
  lastKey: string | null;
  lastAt: number;
};

export const EMPTY_HISTORY: History = { past: [], future: [], lastKey: null, lastAt: 0 };

export const MAX_HISTORY = 60;
/** Bitmaps kept alive by undo steps, in pixels, before the oldest steps are dropped (~1.6 GB RGBA). */
export const HISTORY_PIXEL_BUDGET = 400_000_000;
/** Actions of the same kind closer together than this merge into one step (slider drags, key repeat). */
const COALESCE_MS = 700;

const DOC_KEYS = ['sourceName', 'sourceBitmap', 'editedBitmap', 'cutout', 'transform', 'crop', 'presetId', 'overrides'] as const;

const toDoc = (item: QueueItem): ItemDoc => ({
  id: item.id,
  sourceName: item.sourceName,
  sourceBytes: item.sourceBytes,
  sourceType: item.sourceType,
  sourceDpi: item.sourceDpi,
  sourceBitmap: item.sourceBitmap,
  editedBitmap: item.editedBitmap,
  cutout: item.cutout,
  transform: item.transform,
  crop: item.crop,
  presetId: item.presetId,
  overrides: item.overrides,
});

const sameDoc = (a: ItemDoc, b: ItemDoc): boolean => DOC_KEYS.every((key) => a[key] === b[key]);

export const snapshotOf = (state: AppState): Snapshot => ({
  items: state.items.map(toDoc),
  presets: state.presets,
  presetOrder: state.presetOrder,
  lastPresetId: state.lastPresetId,
  selectedId: state.selectedId,
});

const documentChanged = (before: AppState, after: AppState): boolean =>
  before.presets !== after.presets ||
  before.presetOrder !== after.presetOrder ||
  before.lastPresetId !== after.lastPresetId ||
  before.items.length !== after.items.length ||
  before.items.some((item, index) => {
    const other = after.items[index];
    return !other || other.id !== item.id || !sameDoc(toDoc(item), toDoc(other));
  });

/** Brings the state back to a snapshot. Items whose edits changed get a new revision, so they re-encode. */
const restore = (state: AppState, snapshot: Snapshot): AppState => {
  const items = snapshot.items.map((doc): QueueItem => {
    const current = state.items.find((item) => item.id === doc.id);
    if (current && sameDoc(toDoc(current), doc)) return current;
    if (current) return { ...current, ...doc, revision: current.revision + 1, status: 'idle', error: null };
    return { ...doc, status: 'idle', output: null, error: null, revision: 1, outputRevision: 0 };
  });
  // Show the image the step changed, so undo never happens out of sight.
  const changed = items.find((item) => {
    const current = state.items.find((candidate) => candidate.id === item.id);
    return !current || current !== item;
  });
  const selectedStillThere = items.some((item) => item.id === state.selectedId);
  const selectedId = changed?.id ?? (selectedStillThere ? state.selectedId : (snapshot.selectedId ?? items[0]?.id ?? null));
  return { ...state, items, presets: snapshot.presets, presetOrder: snapshot.presetOrder, lastPresetId: snapshot.lastPresetId, selectedId };
};

/** Every bitmap a snapshot refers to. */
export const snapshotBitmaps = (snapshot: Snapshot): ImageBitmap[] =>
  snapshot.items.flatMap((doc) => [doc.sourceBitmap, doc.editedBitmap, doc.cutout?.base, doc.cutout?.mask].filter((bitmap): bitmap is ImageBitmap => Boolean(bitmap)));

/** Drops the oldest steps once they hold too many pixels. The newest step is always kept. */
const trimPast = (past: Snapshot[]): Snapshot[] => {
  let trimmed = past.slice(-MAX_HISTORY);
  const pixels = (list: Snapshot[]) => {
    const seen = new Set<ImageBitmap>();
    for (const snapshot of list) for (const bitmap of snapshotBitmaps(snapshot)) seen.add(bitmap);
    let total = 0;
    for (const bitmap of seen) total += bitmap.width * bitmap.height;
    return total;
  };
  while (trimmed.length > 1 && pixels(trimmed) > HISTORY_PIXEL_BUDGET) trimmed = trimmed.slice(1);
  return trimmed;
};

const UNDOABLE: ReadonlySet<AppAction['type']> = new Set<AppAction['type']>([
  'addItems',
  'removeItem',
  'renameItem',
  'setCrop',
  'setTransform',
  'setItemPreset',
  'applyPresetToAll',
  'setOverrides',
  'resetOverrides',
  'saveOverridesToPreset',
  'saveOverridesAsNewPreset',
  'setEdit',
  'upsertPreset',
  'deletePreset',
  'movePreset',
  'replacePresets',
]);

/** Which actions merge with the previous one. A `gesture` id (one pointer drag) always merges. */
const coalesceKey = (action: AppAction): { key: string; timed: boolean } | null => {
  if ('gesture' in action && action.gesture) return { key: `gesture:${action.gesture}`, timed: false };
  switch (action.type) {
    case 'setCrop':
      return { key: `crop:${action.id}`, timed: true };
    case 'setEdit':
      return action.mergeKey ? { key: `edit:${action.id}:${action.mergeKey}`, timed: true } : null;
    case 'setOverrides':
      return { key: `overrides:${action.id}:${Object.keys(action.patch).sort().join(',')}`, timed: true };
    default:
      return null;
  }
};

export type HistoryAction = { type: 'undo' } | { type: 'redo' };

/** Wraps the app reducer with snapshot-based undo/redo. */
export const withHistory =
  (reducer: (state: AppState, action: AppAction) => AppState) =>
  (state: AppState, action: AppAction | HistoryAction): AppState => {
    const { history } = state;

    if (action.type === 'undo') {
      const previous = history.past.at(-1);
      if (!previous) return state;
      const restored = restore(state, previous);
      return {
        ...restored,
        // An "Undo" button in a toast is spent once the step is undone.
        notices: restored.notices.filter((notice) => !notice.undoesStep),
        history: { past: history.past.slice(0, -1), future: [...history.future, snapshotOf(state)], lastKey: null, lastAt: 0 },
        announcement: messages().history.undone,
      };
    }
    if (action.type === 'redo') {
      const next = history.future.at(-1);
      if (!next) return state;
      const restored = restore(state, next);
      return {
        ...restored,
        history: { past: trimPast([...history.past, snapshotOf(state)]), future: history.future.slice(0, -1), lastKey: null, lastAt: 0 },
        announcement: messages().history.redone,
      };
    }

    const next = reducer(state, action);
    if (next === state || !UNDOABLE.has(action.type) || !documentChanged(state, next)) return next;

    const now = Date.now();
    const coalesce = coalesceKey(action);
    const merges =
      coalesce !== null &&
      coalesce.key === history.lastKey &&
      history.past.length > 0 &&
      (!coalesce.timed || now - history.lastAt < COALESCE_MS);

    return {
      ...next,
      history: {
        past: merges ? history.past : trimPast([...history.past, snapshotOf(state)]),
        future: [],
        lastKey: coalesce?.key ?? null,
        lastAt: now,
      },
    };
  };

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Text fields keep their own undo. */
export const useHistoryShortcuts = (dispatch: (action: HistoryAction) => void): void => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextEntryTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (key === 'y' && !event.metaKey) {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);
};
