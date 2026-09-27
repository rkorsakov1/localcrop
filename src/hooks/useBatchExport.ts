import { useCallback, useRef, useState } from 'react';
import { dedupeFilenames } from '../lib/filenameTemplate';
import { formatBytes } from '../lib/format';
import { createPdf } from '../lib/pdfWriter';
import type { EncodedOutput } from '../lib/types';
import { triggerDownload, useApp } from '../state/AppContext';
import { encodeQueueItem, revokeOutput, toEncodedOutput } from '../state/encoding';
import { errorText, messages, translateError } from '../i18n';

type DirectoryHandle = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};
type WindowWithDirectoryPicker = Window & { showDirectoryPicker?: (options?: { mode?: 'readwrite'; id?: string }) => Promise<DirectoryHandle> };

export const supportsDirectoryExport = (): boolean => typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function';

export type BatchProgress = { phase: 'encoding' | 'packing' | 'pdf' | 'saving'; done: number; total: number };

type ExportFile = { name: string; blob: Blob; sourceBytes: number; output: EncodedOutput };

/** JPEGs go onto PDF pages as they are; other formats are converted (over white, as PDF pages are). */
const toJpeg = async (blob: Blob): Promise<Blob> => {
  if (blob.type === 'image/jpeg') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((jpeg) => (jpeg ? resolve(jpeg) : reject(new Error('Canvas export failed.'))), 'image/jpeg', 0.92),
    );
  } finally {
    bitmap.close();
  }
};

/** Encodes every out-of-date image (one at a time, in the shared worker), then exports all. */
export const useBatchExport = () => {
  const { state, dispatch, processor, outputFilename, notify } = useApp();
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;
  const presetsRef = useRef(state.presets);
  presetsRef.current = state.presets;

  const encodeAll = useCallback(async (): Promise<ExportFile[]> => {
    const items = [...itemsRef.current];
    const outputs = new Map<string, EncodedOutput>();
    let done = 0;
    setProgress({ phase: 'encoding', done, total: items.length });

    for (const item of items) {
      if (item.output && item.outputRevision === item.revision) {
        outputs.set(item.id, item.output);
      } else {
        dispatch({ type: 'encodeStarted', id: item.id, revision: item.revision });
        try {
          const result = await encodeQueueItem(processor, item, presetsRef.current, false).promise;
          const output = toEncodedOutput(result);
          const current = itemsRef.current.find((candidate) => candidate.id === item.id);
          if (current?.revision === item.revision) {
            revokeOutput(current.output);
            dispatch({ type: 'encodeFinished', id: item.id, revision: item.revision, output });
          }
          outputs.set(item.id, output);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dispatch({ type: 'encodeFailed', id: item.id, revision: item.revision, error: message });
          notify('error', `${item.sourceName}: ${translateError(message)}`);
        }
      }
      done += 1;
      setProgress({ phase: 'encoding', done, total: items.length });
    }

    const exported = items.filter((item) => outputs.has(item.id));
    const names = dedupeFilenames(exported.map((item) => outputFilename(item, outputs.get(item.id))));
    return exported.map((item, index) => ({
      name: names[index] as string,
      blob: (outputs.get(item.id) as EncodedOutput).blob,
      sourceBytes: item.sourceBytes,
      output: outputs.get(item.id) as EncodedOutput,
    }));
  }, [dispatch, processor, outputFilename, notify]);

  const recordSavings = useCallback(
    (files: ExportFile[]) => {
      const before = files.reduce((sum, file) => sum + file.sourceBytes, 0);
      const after = files.reduce((sum, file) => sum + file.blob.size, 0);
      dispatch({ type: 'addSavings', before, after, count: files.length });
      return after;
    },
    [dispatch],
  );

  const exportZip = useCallback(async () => {
    if (progress) return;
    try {
      const files = await encodeAll();
      if (files.length === 0) return;
      setProgress({ phase: 'packing', done: 0, total: files.length });
      const entries = await Promise.all(files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) })));
      const { blob } = await processor.zip({ entries });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      triggerDownload(blob, `localcrop-${stamp}.zip`);
      recordSavings(files);
      dispatch({ type: 'announce', message: messages().batch.exported(files.length, formatBytes(blob.size)) });
    } catch (error) {
      notify('error', messages().batch.exportFailed(errorText(error)));
    } finally {
      setProgress(null);
    }
  }, [progress, encodeAll, processor, recordSavings, dispatch, notify]);

  /** Every image as one page of a single PDF, in queue order. */
  const exportPdf = useCallback(async () => {
    if (progress) return;
    try {
      const files = await encodeAll();
      if (files.length === 0) return;
      setProgress({ phase: 'pdf', done: 0, total: files.length });
      const pages = [];
      for (const [index, file] of files.entries()) {
        const jpeg = await toJpeg(file.output.pdfImage ?? file.output.blob);
        pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), dpi: file.output.dpi });
        setProgress({ phase: 'pdf', done: index + 1, total: files.length });
      }
      const blob = new Blob([createPdf(pages)], { type: 'application/pdf' });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      triggerDownload(blob, `localcrop-${stamp}.pdf`);
      dispatch({ type: 'addSavings', before: files.reduce((sum, file) => sum + file.sourceBytes, 0), after: blob.size, count: files.length });
      dispatch({ type: 'announce', message: messages().batch.exportedPdf(files.length, formatBytes(blob.size)) });
    } catch (error) {
      notify('error', messages().batch.exportFailed(errorText(error)));
    } finally {
      setProgress(null);
    }
  }, [progress, encodeAll, dispatch, notify]);

  const exportToFolder = useCallback(async () => {
    const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (!picker || progress) return;
    let directory: DirectoryHandle;
    try {
      // Ask first, while we still have the click's user activation.
      directory = await picker({ mode: 'readwrite', id: 'localcrop-export' });
    } catch {
      return; // cancelled
    }
    try {
      const files = await encodeAll();
      setProgress({ phase: 'saving', done: 0, total: files.length });
      for (const [index, file] of files.entries()) {
        const handle = await directory.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file.blob);
        await writable.close();
        setProgress({ phase: 'saving', done: index + 1, total: files.length });
      }
      const bytes = recordSavings(files);
      dispatch({ type: 'announce', message: messages().batch.savedFolder(files.length, formatBytes(bytes)) });
    } catch (error) {
      notify('error', messages().batch.folderFailed(errorText(error)));
    } finally {
      setProgress(null);
    }
  }, [progress, encodeAll, recordSavings, dispatch, notify]);

  return { exportZip, exportPdf, exportToFolder, progress };
};

export const describeProgress = (progress: BatchProgress): string => {
  const b = messages().batch;
  if (progress.phase === 'encoding') return b.encoding(progress.done, progress.total);
  if (progress.phase === 'packing') return b.packing(progress.total);
  if (progress.phase === 'pdf') return b.buildingPdf(progress.total);
  return b.saving(progress.done, progress.total);
};
