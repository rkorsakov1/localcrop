import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useZoomView } from '../../hooks/useZoomView';
import { cn } from '../../lib/cn';
import { get2d } from '../../lib/drawing';
import type { QueueItem } from '../../lib/types';
import type { PreviewReference } from '../../hooks/useDebouncedEncode';
import { FORMAT_LABELS, formatBytes } from '../../lib/format';
import { getItemPreset } from '../../state/appReducer';
import { useApp } from '../../state/AppContext';
import { HintChip, panCursor, Stage, Toolbar, ZoomControl } from '../layout/Stage';
import { focusRing, Segmented } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useT } from '../../i18n/useT';
import { checkerboardClass } from './Checkerboard';

type Zoom = 'fit' | 1 | 2 | 'other';
const ZOOMS: { value: Zoom; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: 1, label: '100%' },
  { value: 2, label: '200%' },
];

type CompareViewProps = { item: QueueItem; reference: PreviewReference | null };

type Drag = { pointerId: number };

/** Before/after split: left = source crop resampled to the output size, right = the encoded file. */
export const CompareView = ({ item, reference }: CompareViewProps) => {
  const { state } = useApp();
  const t = useT();
  const preset = getItemPreset(state, item);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [split, setSplit] = useState(50);
  const drag = useRef<Drag | null>(null);
  const output = item.output;
  const outputWidth = output?.width ?? 1;
  const outputHeight = output?.height ?? 1;
  const image = useMemo(() => ({ width: outputWidth, height: outputHeight }), [outputWidth, outputHeight]);
  const zoomed = useRef(false);
  const { view, container, controls } = useZoomView(containerRef, {
    image,
    padding: 16,
    memoryKey: `compare:${item.id}:${outputWidth}x${outputHeight}`,
    // Zoomed in, a drag pans (except on the split handle); fitted, it moves the split.
    panWithPrimary: (event) => zoomed.current && !(event.target instanceof Element && event.target.closest('[role="slider"]')),
  });
  zoomed.current = !controls.isFit;
  const hasView = view !== null;
  const zoom: Zoom = controls.isFit ? 'fit' : Math.abs(controls.zoom - 1) < 0.001 ? 1 : Math.abs(controls.zoom - 2) < 0.001 ? 2 : 'other';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !reference) return;
    canvas.width = reference.bitmap.width;
    canvas.height = reference.bitmap.height;
    get2d(canvas).drawImage(reference.bitmap, 0, 0);
  }, [reference, hasView]);


  const splitFromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !view) return;
    const x = clientX - rect.left - view.offsetX;
    setSplit(Math.round(Math.min(100, Math.max(0, (x / view.displayWidth) * 100))));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !output) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId };
    splitFromPointer(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || !view) return;
    event.stopPropagation();
    splitFromPointer(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
  };

  const handleSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const keys: Record<string, number> = {
      ArrowLeft: split - step,
      ArrowDown: split - step,
      ArrowRight: split + step,
      ArrowUp: split + step,
      Home: 0,
      End: 100,
      PageDown: split - 10,
      PageUp: split + 10,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSplit(Math.min(100, Math.max(0, next)));
  };

  const layerStyle = view
    ? { left: view.offsetX, top: view.offsetY, width: view.displayWidth, height: view.displayHeight }
    : undefined;

  const encodedLabel = output
    ? `${t.compare.encoded} · ${FORMAT_LABELS[preset.format]}${preset.format === 'png' ? '' : ` q${output.quality}`} · ${formatBytes(output.blob.size)}`
    : '';
  const pixelated = controls.zoom >= 2;
  const handleX = view ? view.offsetX + (view.displayWidth * split) / 100 : 0;

  return (
    <>
      <Toolbar label={t.compare.zoomToolbar}>
        <Segmented<Zoom>
          label={t.compare.zoom}
          value={zoom}
          disabled={!output}
          options={ZOOMS.map((option) => (option.value === 'fit' ? { ...option, label: t.compare.fit } : option))}
          onChange={(value) => (value === 'fit' ? controls.fit() : typeof value === 'number' ? controls.setZoom(value) : undefined)}
        />
        <span className="ml-2 text-xs text-ink-3">{controls.isFit ? t.compare.dragCompare : t.compare.dragPan}</span>
        <span className="min-w-4 flex-1" />
        <span className="text-xs text-ink-3 max-lg:hidden">{t.compare.legend}</span>
      </Toolbar>
      <Stage>
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={cn(
            'absolute inset-0 touch-none overflow-hidden select-none',
            { 'cursor-grab': !controls.isFit, 'cursor-col-resize': controls.isFit && output !== null },
            panCursor(controls),
          )}
        >
          {view && output ? (
            <>
              <div aria-hidden="true" className={cn('absolute', checkerboardClass)} style={layerStyle} />
              <img
                src={output.previewUrl}
                alt={t.compare.encodedAlt}
                draggable={false}
                className={cn('absolute max-w-none', { '[image-rendering:pixelated]': pixelated })}
                style={layerStyle}
              />
              <canvas
                ref={canvasRef}
                aria-label={t.compare.sourceAlt}
                className={cn('absolute', { '[image-rendering:pixelated]': pixelated, invisible: !reference })}
                style={{ ...layerStyle, clipPath: `inset(0 ${100 - split}% 0 0)` }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]"
                style={{ left: handleX, top: Math.max(0, view.offsetY), height: Math.min(container.height, view.displayHeight) }}
              />
              <div
                role="slider"
                tabIndex={0}
                aria-label={t.compare.slider}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={split}
                aria-valuetext={t.compare.sliderValue(split)}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onKeyDown={handleSliderKeyDown}
                className={cn(
                  'absolute flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full bg-white text-[#191918] shadow-float',
                  'before:absolute before:-inset-1', // 44px touch target
                  focusRing,
                )}
                style={{ left: handleX, top: Math.min(container.height - 24, Math.max(24, view.offsetY + view.displayHeight / 2)) }}
              >
                <Icon name="split" className="size-4" strokeWidth={1.8} />
              </div>
              <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-[rgb(24_24_22/.8)] px-2 py-1 text-[11px] font-semibold text-white">
                {t.compare.source}
              </span>
              <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-[rgb(24_24_22/.8)] px-2 py-1 font-mono text-[11px] font-semibold text-white">
                {encodedLabel}
              </span>
            </>
          ) : null}
        </div>
        {/* On phones the toolbar's zoom buttons do the job; the chip would cover the labels. */}
        {output ? <ZoomControl controls={controls} className="max-lg:hidden" /> : <HintChip>{t.compare.pending}</HintChip>}
      </Stage>
    </>
  );
};
