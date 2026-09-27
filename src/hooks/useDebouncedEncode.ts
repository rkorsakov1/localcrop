import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '../lib/types';
import { useApp } from '../state/AppContext';
import { encodeQueueItem, revokeOutput, toEncodedOutput } from '../state/encoding';
import { isCancelledError } from '../worker/protocol';
import type { EncodeHandle } from '../worker/workerClient';

export const PREVIEW_DEBOUNCE_MS = 300;

export type PreviewReference = { itemId: string; revision: number; bitmap: ImageBitmap };

/**
 * Re-encodes the selected item 300 ms after its last change and stores the real output.
 * Only the newest request is shown: older ones are cancelled, and late results are dropped.
 */
export const useDebouncedEncode = (): PreviewReference | null => {
  const { state, dispatch, processor, selectedItem } = useApp();
  const [reference, setReference] = useState<PreviewReference | null>(null);
  const activeRequest = useRef<EncodeHandle | null>(null);
  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;
  const presetsRef = useRef(state.presets);
  presetsRef.current = state.presets;

  const itemId = selectedItem?.id ?? null;
  const revision = selectedItem?.revision ?? 0;
  const upToDate = selectedItem ? selectedItem.outputRevision === selectedItem.revision : true;

  useEffect(() => {
    if (!itemId || upToDate) return;

    const findItem = (): QueueItem | undefined => itemsRef.current.find((item) => item.id === itemId);

    const timer = setTimeout(async () => {
      const item = findItem();
      if (!item || item.revision !== revision) return;

      if (activeRequest.current) processor.cancel(activeRequest.current.requestId);
      const handle = encodeQueueItem(processor, item, presetsRef.current, true);
      activeRequest.current = handle;
      dispatch({ type: 'encodeStarted', id: item.id, revision });

      try {
        const result = await handle.promise;
        const current = findItem();
        if (!current || current.revision !== revision) {
          result.reference?.close();
          return;
        }
        const previous = current.output;
        dispatch({ type: 'encodeFinished', id: item.id, revision, output: toEncodedOutput(result) });
        revokeOutput(previous);
        if (result.reference) {
          const bitmap = result.reference;
          setReference((previous) => {
            previous?.bitmap.close();
            return { itemId: item.id, revision, bitmap };
          });
        }
      } catch (error) {
        if (isCancelledError(error)) {
          dispatch({ type: 'encodeCancelled', id: item.id, revision });
          return;
        }
        dispatch({ type: 'encodeFailed', id: item.id, revision, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (activeRequest.current === handle) activeRequest.current = null;
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [itemId, revision, upToDate, processor, dispatch]);

  return reference && reference.itemId === itemId ? reference : null;
};
