import { useEffect, useMemo, useRef, useState } from 'react';
import { useZoomView } from '../../hooks/useZoomView';
import { transformedSize } from '../../lib/cropMath';
import { formatBytes } from '../../lib/format';
import type { Cutout, QueueItem } from '../../lib/types';
import { getItemPreset } from '../../state/appReducer';
import { useApp } from '../../state/AppContext';
import { ORT_RUNTIME, SEGMENTATION_MODEL } from '../../worker/segmentationModel';
import { isModelCached, releaseSegmenter, segmentImage, type SegmentProgress } from '../../worker/segmentClient';
import { ImageCanvas } from '../crop/ImageCanvas';
import { HintChip, panCursor, Stage, Toolbar, ToolbarDivider } from '../layout/Stage';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ColorInput, Toggle } from '../ui/Field';
import { Icon, Spinner } from '../ui/Icon';
import { BrushToolbar } from './BrushToolbar';
import { createMaskCanvas, defaultBrushSize, MaskEditor, readMask, type BrushSettings } from './MaskEditor';
import { errorText, messages } from '../../i18n';
import { useT } from '../../i18n/useT';

const STAGE_STEP: Record<SegmentProgress['stage'], number> = { runtime: 1, model: 1, session: 2, inference: 3 };

/** The current image, fitted to the stage, with an optional scan line while the model runs. */
const ImageStage = ({ item, scanning }: { item: QueueItem; scanning: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bitmap = item.editedBitmap ?? item.sourceBitmap;
  const image = useMemo(() => transformedSize(bitmap, item.transform.rotation), [bitmap, item.transform.rotation]);
  // Zooms with the keyboard and Ctrl + wheel like the other stages; the controls appear once there is a cut-out to refine.
  const { view, controls } = useZoomView(containerRef, { image, memoryKey: `${item.id}:${image.width}x${image.height}` });
  return (
    <div ref={containerRef} className={cn('absolute inset-0', panCursor(controls))}>
      {view ? (
        <>
          <ImageCanvas bitmap={bitmap} transform={item.transform} view={view} />
          {scanning ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute overflow-hidden"
              style={{ left: view.offsetX, top: view.offsetY, width: view.displayWidth, height: view.displayHeight }}
            >
              <div className="absolute inset-x-0 h-0.5 bg-accent shadow-[0_0_12px_2px_var(--color-accent)] [animation:lc-scan_1.6s_var(--ease-std)_infinite_alternate]" />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

const FloatingCard = ({ children }: { children: React.ReactNode }) => (
  <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-[27rem] rounded-lg bg-raised p-4 shadow-float [animation:lc-rise_.24s_var(--ease-out)]">{children}</div>
);

const ProgressCard = ({ progress }: { progress: SegmentProgress }) => {
  const t = useT();
  const STAGE_LABEL = t.background.stages;
  const determinate = progress.total > 0;
  const percent = determinate ? Math.round((progress.loaded / progress.total) * 100) : 0;
  return (
    <FloatingCard>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold">{STAGE_LABEL[progress.stage]}</p>
        {determinate ? (
          <p className="font-mono text-[11px] text-ink-3">
            {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
          </p>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={STAGE_LABEL[progress.stage]}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? percent : undefined}
        className="mt-2.5 h-1 overflow-hidden rounded-full bg-sunken"
      >
        {determinate ? (
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        )}
      </div>
      <p className="mt-2 text-xs text-ink-3">{t.background.step(STAGE_STEP[progress.stage])}</p>
    </FloatingCard>
  );
};

/** Background mode: segment with the on-device model; the cut-out is applied at once, and each Restore/Erase stroke updates it. */
export const BackgroundPanel = ({ item }: { item: QueueItem }) => {
  const { state, dispatch, editor, notify, setEdit } = useApp();
  const t = useT();
  const bitmap = item.editedBitmap ?? item.sourceBitmap;
  const cutout = item.cutout;
  const [progress, setProgress] = useState<SegmentProgress | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [brush, setBrush] = useState<BrushSettings>(() => ({ size: defaultBrushSize(bitmap), erase: false, soft: true }));
  const [busy, setBusy] = useState(false);
  const [jpegPrompt, setJpegPrompt] = useState(false);
  const [lastColor, setLastColor] = useState('#ffffff');
  const [version, setVersion] = useState(0);
  const preset = getItemPreset(state, item);

  // Working mask canvas, kept in sync with the cut-out's (immutable) mask bitmap. Undo swaps the bitmap.
  const maskWidth = cutout?.mask.width ?? 0;
  const maskHeight = cutout?.mask.height ?? 0;
  const mask = useMemo(() => (maskWidth > 0 ? createMaskCanvas(maskWidth, maskHeight) : null), [maskWidth, maskHeight]);
  /** Which mask bitmap the canvas currently holds (strokes update both at once). */
  const synced = useRef<{ canvas: HTMLCanvasElement; bitmap: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!cutout || !mask) return;
    if (synced.current?.canvas === mask && synced.current.bitmap === cutout.mask) return;
    const context = mask.getContext('2d');
    context?.clearRect(0, 0, mask.width, mask.height);
    context?.drawImage(cutout.mask, 0, 0);
    synced.current = { canvas: mask, bitmap: cutout.mask };
    setVersion((value) => value + 1);
  }, [cutout, mask]);

  useEffect(() => {
    void isModelCached().then(setCached);
  }, []);

  // Leaving background mode releases the ONNX session and model memory.
  useEffect(() => () => releaseSegmenter(), []);

  /** Composes `base` with the mask and stores it as one undoable step. */
  /** `workingCanvas`: the on-screen mask canvas this result belongs to (it may already hold newer strokes). */
  const commit = async (next: Omit<Cutout, 'mask'>, maskCanvas: HTMLCanvasElement, mergeKey?: string, workingCanvas: HTMLCanvasElement = maskCanvas) => {
    const [maskBitmap, composed] = await Promise.all([
      createImageBitmap(maskCanvas),
      editor.compose({ bitmap: next.base, alpha: readMask(maskCanvas), background: next.background }),
    ]);
    synced.current = { canvas: workingCanvas, bitmap: maskBitmap };
    setEdit(item.id, composed.bitmap, { ...next, mask: maskBitmap }, mergeKey);
  };

  const handleRemove = async () => {
    setProgress({ stage: 'runtime', loaded: 0, total: 0 });
    try {
      const { alpha, provider } = await segmentImage(bitmap, setProgress);
      setCached(true);
      await commit({ base: bitmap, background: null, provider }, createMaskCanvas(bitmap.width, bitmap.height, alpha));
      dispatch({ type: 'announce', message: messages().background.done(provider === 'webgpu') });
      if (preset.format === 'jpeg') setJpegPrompt(true);
    } catch (error) {
      notify('error', messages().background.failed(errorText(error)));
    } finally {
      setProgress(null);
    }
  };

  // Painting never waits: each finished stroke snapshots the mask and joins a queue, so every
  // stroke still becomes its own undo step.
  const strokeQueue = useRef<Promise<ImageBitmap>[]>([]);
  const draining = useRef(false);

  const drainStrokes = async (base: Omit<Cutout, 'mask'>) => {
    if (draining.current || !mask) return;
    draining.current = true;
    setBusy(true);
    try {
      for (let next = strokeQueue.current.shift(); next; next = strokeQueue.current.shift()) {
        const snapshot = await next;
        const canvas = createMaskCanvas(snapshot.width, snapshot.height);
        canvas.getContext('2d')?.drawImage(snapshot, 0, 0);
        snapshot.close();
        try {
          await commit(base, canvas, undefined, mask);
        } catch (error) {
          notify('error', errorText(error));
        }
      }
    } finally {
      draining.current = false;
      setBusy(false);
    }
  };

  const handleStrokeEnd = () => {
    if (!cutout || !mask) return;
    // createImageBitmap copies the canvas as it is right now, before later strokes land on it.
    strokeQueue.current.push(createImageBitmap(mask));
    void drainStrokes({ base: cutout.base, background: cutout.background, provider: cutout.provider });
  };

  const setBackground = (background: string | null) => {
    if (!cutout || !mask) return;
    if (background) setLastColor(background);
    // Dragging through the color picker merges into one undo step.
    void commit({ ...cutout, background }, mask, 'background').catch((error: unknown) =>
      notify('error', errorText(error)),
    );
  };

  const discard = () => {
    if (!cutout) return;
    setEdit(item.id, cutout.base === item.sourceBitmap ? null : cutout.base, null);
    dispatch({ type: 'announce', message: t.background.restored });
  };

  const switchFormat = (format: 'webp' | 'png') => {
    dispatch({ type: 'setOverrides', id: item.id, patch: { format } });
    setJpegPrompt(false);
  };

  return (
    <>
      {cutout && mask ? (
        <Toolbar label={t.background.tools}>
          <BrushToolbar brush={brush} onChange={setBrush} paintLabel={t.background.restore} eraseLabel={t.background.erase} />
          <ToolbarDivider />
          <Toggle label={t.background.replace} checked={cutout.background !== null} onChange={(on) => setBackground(on ? lastColor : null)} />
          <ColorInput label={t.background.color} className="ml-1.5" value={cutout.background ?? lastColor} disabled={cutout.background === null} onChange={setBackground} />
          <span className="min-w-4 flex-1" />
          <Button variant="ghost" size="sm" onClick={discard} title={t.background.discardTitle}>
            {t.background.discard}
          </Button>
        </Toolbar>
      ) : (
        <Toolbar label={t.background.toolbar}>
          <Button variant="primary" size="sm" disabled={progress !== null} aria-busy={progress !== null} onClick={() => void handleRemove()}>
            {progress ? <Spinner /> : <Icon name="spark" />} {t.background.remove}
          </Button>
          <span className="ml-2 text-xs text-ink-2 max-lg:hidden">{t.background.intro}</span>
          <span className="min-w-4 flex-1" />
          <span className="font-mono text-[11px] text-ink-3 max-2xl:hidden">{SEGMENTATION_MODEL.label}</span>
        </Toolbar>
      )}

      <Stage>
        {cutout && mask ? (
          <>
            <MaskEditor
              bitmap={cutout.base}
              transform={item.transform}
              mask={mask}
              variant="alpha"
              backdrop={cutout.background}
              brush={brush}
              onBrushChange={setBrush}
              version={version}
              onStrokeEnd={handleStrokeEnd}
              label={t.background.cutout}
              zoomKey={item.id}
            />
            <HintChip tone={busy ? 'busy' : 'neutral'}>
              {busy ? (
                <span className="flex items-center gap-2">
                  <Spinner /> {t.background.updating}
                </span>
              ) : (
                <>
                  <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-success-bar align-middle" />
                  {t.background.ranOn(cutout.provider === 'webgpu')}
                </>
              )}
            </HintChip>
          </>
        ) : (
          <>
            <ImageStage item={item} scanning={progress?.stage === 'inference'} />
            {progress ? (
              <ProgressCard progress={progress} />
            ) : (
              <FloatingCard>
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{t.background.remove}</p>
                    <p className="mt-0.5 text-xs text-ink-3">{t.background.cardText(Boolean(cached), formatBytes(SEGMENTATION_MODEL.bytes + ORT_RUNTIME.wasmBytes))}</p>
                  </div>
                  <Button variant="primary" onClick={() => void handleRemove()}>
                    <Icon name="spark" /> {t.background.removeShort}
                  </Button>
                </div>
              </FloatingCard>
            )}
          </>
        )}
      </Stage>

      <Dialog
        open={jpegPrompt}
        onClose={() => setJpegPrompt(false)}
        title={t.background.jpegTitle}
        footer={
          <>
            <Button onClick={() => switchFormat('webp')}>{t.background.toWebp}</Button>
            <Button onClick={() => switchFormat('png')}>{t.background.toPng}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setJpegPrompt(false);
                setBackground(lastColor);
              }}
            >
              {t.background.useColor}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">{t.background.jpegText(preset.matteColor.toUpperCase())}</p>
      </Dialog>
    </>
  );
};
