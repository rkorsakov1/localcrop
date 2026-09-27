import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { renderFilename } from '../lib/filenameTemplate';
import { errorText, messages, presetLabel, setLanguage, syncLanguagePath, translateError } from '../i18n';
import { formatBytes, formatSavings } from '../lib/format';
import type { Cutout, EncodedOutput, QueueItem } from '../lib/types';
import { createWorkerClient, type Processor } from '../worker/workerClient';
import { appReducer, createInitialState, getItemPreset, type AppAction, type AppState, type Notice } from './appReducer';
import { snapshotBitmaps, snapshotOf, withHistory, type HistoryAction } from './history';
import { decodeImage, expandArchives, LARGE_IMAGE_PIXELS, type DecodeFailure } from './ingest';
import { loadPersistedState, savePersistedState } from './storage';

type AppContextValue = {
  state: AppState;
  dispatch: (action: AppAction | HistoryAction) => void;
  processor: Processor;
  /** A second worker for retouch fills and cut-out composing, so brush strokes don't queue behind preview encodes. */
  editor: Processor;
  selectedItem: QueueItem | null;
  addFiles: (files: readonly (File | { blob: Blob; name: string })[]) => Promise<void>;
  removeItem: (id: string) => void;
  notify: (tone: Notice['tone'], message: string, action?: Notice['action'], persistent?: boolean) => void;
  /** Filename from the preset's template; pass `output` when it isn't stored on the item yet. */
  outputFilename: (item: QueueItem, output?: EncodedOutput | null) => string;
  downloadItem: (item: QueueItem) => void;
  /** Sets (or with null, reverts) an item's edited image and cut-out. Undoable; old bitmaps are freed once no undo step needs them. */
  setEdit: (id: string, bitmap: ImageBitmap | null, cutout?: Cutout | null, mergeKey?: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export const useApp = (): AppContextValue => {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>.');
  return value;
};

const historyReducer = withHistory(appReducer);

/** Every bitmap the current state or its undo/redo steps can still show. */
const liveBitmaps = (state: AppState): Set<ImageBitmap> => {
  const live = new Set<ImageBitmap>(snapshotBitmaps(snapshotOf(state)));
  for (const snapshot of [...state.history.past, ...state.history.future]) for (const bitmap of snapshotBitmaps(snapshot)) live.add(bitmap);
  return live;
};

export const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(historyReducer, undefined, () => createInitialState(loadPersistedState()));
  const processor = useMemo(() => createWorkerClient(), []);
  const editor = useMemo(() => createWorkerClient('editor'), []);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Set during render, so every formatter below the provider uses this render's language.
  setLanguage(state.prefs.language);
  useEffect(() => syncLanguagePath(state.prefs.language), [state.prefs.language]);

  useEffect(() => {
    const saved = savePersistedState({ presets: state.presets, presetOrder: state.presetOrder, lastPresetId: state.lastPresetId, prefs: state.prefs });
    if (!saved) console.warn('Could not save presets to localStorage.');
  }, [state.presets, state.presetOrder, state.lastPresetId, state.prefs]);

  // Free bitmaps no longer reachable from the state or undo history, and preview URLs of removed images.
  const tracked = useRef(new Set<ImageBitmap>());
  const previousItems = useRef<QueueItem[]>([]);
  useEffect(() => {
    const live = liveBitmaps(state);
    const dead = [...tracked.current].filter((bitmap) => !live.has(bitmap));
    tracked.current = live;
    // Delay so nothing that rendered from the old state draws a closed bitmap.
    if (dead.length > 0) setTimeout(() => dead.forEach((bitmap) => bitmap.close()), 1000);

    const present = new Set(state.items.map((item) => item.id));
    for (const item of previousItems.current) if (!present.has(item.id) && item.output) URL.revokeObjectURL(item.output.url);
    previousItems.current = state.items;
  }, [state]);

  const notify = useCallback((tone: Notice['tone'], message: string, action?: Notice['action'], persistent = false) => {
    dispatch({ type: 'notify', notice: { id: crypto.randomUUID(), tone, message, action, persistent } });
  }, []);

  const addFiles = useCallback<AppContextValue['addFiles']>(
    async (incoming) => {
      const expanded = await expandArchives(incoming);
      const files = expanded.files;
      const failures: DecodeFailure[] = [...expanded.failures];
      const decoded = await Promise.all(
        files.map(async (file) => {
          const blob = file instanceof File ? file : file.blob;
          const name = file.name;
          try {
            return await decodeImage(blob, name);
          } catch (error) {
            failures.push({ name, message: errorText(error) });
            return null;
          }
        }),
      );

      const items = decoded.flatMap((image) => {
        if (!image) return [];
        if (image.bitmap.width * image.bitmap.height > LARGE_IMAGE_PIXELS) {
          const megapixels = Math.round((image.bitmap.width * image.bitmap.height) / 1_000_000);
          notify('warning', messages().queue.large(image.name, megapixels));
        }
        return [
          { id: crypto.randomUUID(), sourceName: image.name, sourceBytes: image.bytes, sourceType: image.type, sourceBitmap: image.bitmap },
        ];
      });

      dispatch({ type: 'addItems', items });
      for (const failure of failures) notify('error', `${failure.name}: ${translateError(failure.message)}`);
      if (items.length > 0) {
        dispatch({ type: 'announce', message: messages().queue.added(items.length) });
      }
    },
    [notify],
  );

  const removeItem = useCallback((id: string) => {
    const item = stateRef.current.items.find((candidate) => candidate.id === id);
    if (!item) return;
    dispatch({ type: 'removeItem', id });
    dispatch({
      type: 'notify',
      notice: {
        id: crypto.randomUUID(),
        tone: 'info',
        message: messages().queue.removed(item.sourceName),
        action: { label: messages().history.undo, run: () => dispatch({ type: 'undo' }) },
        undoesStep: true,
      },
    });
  }, []);

  const outputFilename = useCallback((item: QueueItem, output: EncodedOutput | null = item.output): string => {
    const current = stateRef.current;
    const preset = getItemPreset(current, item);
    const index = current.items.findIndex((candidate) => candidate.id === item.id);
    return renderFilename(preset.filenameTemplate, {
      sourceName: item.sourceName,
      width: output?.width ?? preset.width ?? item.sourceBitmap.width,
      height: output?.height ?? preset.height ?? item.sourceBitmap.height,
      presetName: presetLabel(preset),
      index: index + 1,
      queueLength: current.items.length,
      format: preset.format,
    });
  }, []);

  const downloadItem = useCallback(
    (item: QueueItem) => {
      if (!item.output || item.outputRevision !== item.revision) return;
      const filename = outputFilename(item);
      triggerDownload(item.output.blob, filename);
      dispatch({ type: 'addSavings', before: item.sourceBytes, after: item.output.blob.size, count: 1 });
      const change = formatSavings(item.sourceBytes, item.output.blob.size);
      notify('success', messages().output.saved(filename, formatBytes(item.output.blob.size), change.startsWith('−') ? change.slice(1) : null));
    },
    [outputFilename, notify],
  );

  const setEdit = useCallback((id: string, bitmap: ImageBitmap | null, cutout: Cutout | null = null, mergeKey?: string) => {
    dispatch({ type: 'setEdit', id, bitmap, cutout, mergeKey });
  }, []);

  const selectedItem = state.items.find((item) => item.id === state.selectedId) ?? null;

  const value = useMemo<AppContextValue>(
    () => ({ state, dispatch, processor, editor, selectedItem, addFiles, removeItem, notify, outputFilename, downloadItem, setEdit }),
    [state, processor, editor, selectedItem, addFiles, removeItem, notify, outputFilename, downloadItem, setEdit],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
