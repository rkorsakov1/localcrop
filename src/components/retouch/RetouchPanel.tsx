import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../../lib/cropMath';
import type { Rect } from '../../lib/inpaint';
import type { QueueItem } from '../../lib/types';
import { useApp } from '../../state/AppContext';
import type { FillMethod } from '../../worker/protocol';
import { HintChip, Stage, Toolbar, ToolbarDivider } from '../layout/Stage';
import { Button, Segmented } from '../ui/Button';
import { ColorInput } from '../ui/Field';
import { Icon, Spinner } from '../ui/Icon';
import { BrushToolbar } from './BrushToolbar';
import { createMaskCanvas, defaultBrushSize, MaskEditor, readMask, type BrushSettings } from './MaskEditor';
import { errorText, messages } from '../../i18n';
import { useT } from '../../i18n/useT';

type RGB = [number, number, number];

/** A finished stroke waiting to be applied: its mask pixels are copied when it ends. */
type Stroke = { region: Rect; values: Uint8Array; erase: boolean; method: FillMethod; color: RGB | null };

const toHex = ([r, g, b]: RGB): string => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

const fromHex = (hex: string): RGB => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const sampleColor = (bitmap: ImageBitmap, point: Point): RGB | null => {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
};

/** A canvas whose alpha is `values` over `region` (white elsewhere is irrelevant). */
const maskPatch = (region: Rect, values: Uint8Array): HTMLCanvasElement => {
  const patch = document.createElement('canvas');
  patch.width = region.width;
  patch.height = region.height;
  const context = patch.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available.');
  const pixels = context.createImageData(region.width, region.height);
  for (let index = 0; index < values.length; index += 1) {
    pixels.data[index * 4] = 255;
    pixels.data[index * 4 + 1] = 255;
    pixels.data[index * 4 + 2] = 255;
    pixels.data[index * 4 + 3] = values[index] as number;
  }
  context.putImageData(pixels, 0, 0);
  return patch;
};

/** Paints the original pixels back where the stroke's mask is set. */
const restoreOriginal = async (current: ImageBitmap, original: ImageBitmap, region: Rect, values: Uint8Array): Promise<ImageBitmap> => {
  const strokeMask = maskPatch(region, values);
  const patch = document.createElement('canvas');
  patch.width = region.width;
  patch.height = region.height;
  const patchContext = patch.getContext('2d');
  const canvas = document.createElement('canvas');
  canvas.width = current.width;
  canvas.height = current.height;
  const context = canvas.getContext('2d');
  if (!patchContext || !context) throw new Error('Canvas 2D is not available.');
  patchContext.drawImage(original, -region.x, -region.y);
  patchContext.globalCompositeOperation = 'destination-in';
  patchContext.drawImage(strokeMask, 0, 0);
  context.drawImage(current, 0, 0);
  // Clear under the patch first, so restoring over transparency (a removed background) works too.
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(strokeMask, region.x, region.y);
  context.globalCompositeOperation = 'source-over';
  context.drawImage(patch, region.x, region.y);
  return createImageBitmap(canvas);
};

/** The stroke's box plus a margin of surrounding pixels to fill from (whole pixels, inside the image). */
const STROKE_MARGIN = 12;
const strokeRegion = (rect: Rect, image: { width: number; height: number }): Rect => {
  const x = Math.max(0, Math.floor(rect.x - STROKE_MARGIN));
  const y = Math.max(0, Math.floor(rect.y - STROKE_MARGIN));
  const right = Math.min(image.width, Math.ceil(rect.x + rect.width + STROKE_MARGIN));
  const bottom = Math.min(image.height, Math.ceil(rect.y + rect.height + STROKE_MARGIN));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};

const methodOptions = (): { value: FillMethod; label: string; title: string }[] => {
  const r = messages().retouch;
  return [
    { value: 'flat', label: r.flat, title: r.flatTitle },
    { value: 'smooth', label: r.smooth, title: r.smoothTitle },
  ];
};

/** Retouch mode: every stroke is filled from its surroundings as soon as it ends. Each stroke is one undo step. */
export const RetouchPanel = ({ item }: { item: QueueItem }) => {
  const { state, editor, notify, dispatch, setEdit } = useApp();
  const t = useT();
  const bitmap = item.editedBitmap ?? item.sourceBitmap;
  const mask = useMemo(() => createMaskCanvas(bitmap.width, bitmap.height), [bitmap.width, bitmap.height]);
  const [version, setVersion] = useState(0);
  const [brush, setBrush] = useState<BrushSettings>(() => ({ size: defaultBrushSize(bitmap), erase: false, soft: false }));
  const method = state.prefs.fillMethod;
  const setMethod = (fillMethod: FillMethod) => dispatch({ type: 'setPref', patch: { fillMethod } });
  const [flatColor, setFlatColor] = useState<RGB | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Only mention the work if it takes long enough to notice; quick strokes shouldn't flicker the hint.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(timer);
  }, [busy]);
  const canRestore = item.editedBitmap !== null;
  const effectiveBrush = canRestore ? brush : { ...brush, erase: false };

  // Strokes are applied one after another. Painting never waits: a stroke that ends while the
  // previous one is still filling joins the queue and stays visible in the mask until it's done.
  const queue = useRef<Stroke[]>([]);
  const running = useRef(false);
  /** The newest image, including results React hasn't rendered yet. */
  const latest = useRef(bitmap);
  const ownResult = useRef<ImageBitmap | null>(null);

  // A new image from outside (undo, redo, another tool) starts with an empty mask.
  useEffect(() => {
    latest.current = bitmap;
    if (bitmap === ownResult.current || running.current) return;
    mask.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
    setVersion((value) => value + 1);
  }, [bitmap, mask]);

  const handlePick = (point: Point) => {
    const color = sampleColor(bitmap, point);
    setPicking(false);
    if (!color) return;
    setFlatColor(color);
    dispatch({ type: 'announce', message: t.retouch.colorSet(toHex(color)) });
  };

  /** Removes a finished stroke from the mask (only its own pixels; later strokes stay). */
  const eraseFromMask = (stroke: Stroke) => {
    const context = mask.getContext('2d');
    if (!context) return;
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(maskPatch(stroke.region, stroke.values), stroke.region.x, stroke.region.y);
    context.globalCompositeOperation = 'source-over';
    setVersion((value) => value + 1);
  };

  const applyStroke = async (stroke: Stroke): Promise<void> => {
    const current = latest.current;
    let next: ImageBitmap;
    if (stroke.erase) {
      next = await restoreOriginal(current, item.sourceBitmap, stroke.region, stroke.values);
    } else {
      const result = await editor.fill({ bitmap: current, mask: stroke.values.slice(), region: stroke.region, method: stroke.method, color: stroke.color });
      next = result.bitmap;
      if (result.color && stroke.method === 'flat' && !flatColor) setFlatColor(result.color);
    }
    latest.current = next;
    ownResult.current = next;
    setEdit(item.id, next);
  };

  const drainQueue = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      for (let stroke = queue.current.shift(); stroke; stroke = queue.current.shift()) {
        try {
          await applyStroke(stroke);
        } catch (error) {
          notify('error', errorText(error));
        }
        eraseFromMask(stroke);
      }
      dispatch({ type: 'announce', message: messages().retouch.applied });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const handleStrokeEnd = (rect: Rect) => {
    const region = strokeRegion(rect, bitmap);
    queue.current.push({
      region,
      values: readMask(mask, region),
      erase: effectiveBrush.erase,
      method,
      color: method === 'flat' ? flatColor : null,
    });
    void drainQueue();
  };

  return (
    <>
      <Toolbar label={t.retouch.tools}>
        <BrushToolbar brush={effectiveBrush} onChange={setBrush} paintLabel={t.retouch.paint} eraseLabel={t.retouch.restore} eraseDisabled={!canRestore} />
        <ToolbarDivider />
        <Segmented<FillMethod> label={t.retouch.method} value={method} options={methodOptions()} onChange={setMethod} />
        {method === 'flat' ? (
          <>
            <ColorInput
              label={t.retouch.flatColor}
              className="ml-1.5"
              value={flatColor ? toHex(flatColor) : '#808080'}
              onChange={(value) => setFlatColor(fromHex(value))}
            />
            <Button variant="ghost" size="icon" pressed={picking} onClick={() => setPicking((value) => !value)} aria-label={t.retouch.pick} title={t.retouch.eyedropper}>
              <Icon name="eyedropper" />
            </Button>
            <Button variant="ghost" size="sm" pressed={!flatColor} onClick={() => setFlatColor(null)} title={t.retouch.autoTitle}>
              {t.retouch.auto}
            </Button>
          </>
        ) : null}
        <span className="min-w-4 flex-1" />
        <Button variant="ghost" size="sm" disabled={!item.editedBitmap} onClick={() => setEdit(item.id, null)} title={t.retouch.revertTitle}>
          {t.retouch.revertAll}
        </Button>
      </Toolbar>
      <Stage>
        <MaskEditor
          bitmap={bitmap}
          transform={item.transform}
          mask={mask}
          variant="mask"
          brush={effectiveBrush}
          onBrushChange={setBrush}
          version={version}
          onStrokeEnd={handleStrokeEnd}
          onStrokeAbort={(rect) => {
            const region = strokeRegion(rect, bitmap);
            mask.getContext('2d')?.clearRect(region.x, region.y, region.width, region.height);
            setVersion((value) => value + 1);
          }}
          onPick={picking ? handlePick : undefined}
          label={t.retouch.brushLabel}
          zoomKey={item.id}
        />
        {slow ? (
          <HintChip tone="busy">
            <span className="flex items-center gap-2">
              <Spinner /> {t.retouch.applying}
            </span>
          </HintChip>
        ) : (
          <HintChip>
            {picking
              ? t.retouch.pickHint
              : effectiveBrush.erase
                ? t.retouch.restoreHint
                : t.retouch.paintHint}
          </HintChip>
        )}
      </Stage>
    </>
  );
};
