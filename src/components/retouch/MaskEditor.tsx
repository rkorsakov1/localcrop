import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { isTextEntryTarget } from '../../hooks/useKeyboardShortcuts';
import { useZoomView } from '../../hooks/useZoomView';
import { cn } from '../../lib/cn';
import { screenToSource, transformedSize, transformedToSource, visibleRect, type Point } from '../../lib/cropMath';
import { drawTransformed } from '../../lib/drawing';
import type { Rect } from '../../lib/inpaint';
import type { Transform } from '../../lib/types';
import { boxStyle, ImageCanvas, prepareVisibleCanvas } from '../crop/ImageCanvas';
import { panCursor, ZoomControl } from '../layout/Stage';
import { focusRing } from '../ui/Button';
import { checkerboardClass } from '../preview/Checkerboard';
import { useT } from '../../i18n/useT';

export type BrushSettings = { size: number; erase: boolean; soft: boolean };

type MaskEditorProps = {
  /** Image being edited, in source orientation. */
  bitmap: ImageBitmap;
  transform: Transform;
  /** Source-sized canvas; its alpha channel is the mask. */
  mask: HTMLCanvasElement;
  /** 'mask': tinted overlay of the stroke being painted. 'alpha': the cut-out itself (Restore/Erase). */
  variant: 'mask' | 'alpha';
  brush: BrushSettings;
  onBrushChange: (brush: BrushSettings) => void;
  /** Change this whenever the mask canvas is modified from outside, so the view redraws. */
  version: number;
  /** Called when a stroke ends, with the area it touched (source pixels). The stroke is already in `mask`. */
  onStrokeEnd: (rect: Rect) => void;
  /** A stroke was cancelled (a second finger turned it into a pinch): undo its pixels in `mask` within `rect`. */
  onStrokeAbort?: (rect: Rect) => void;
  /** Ignore painting (e.g. while the previous stroke is being applied). */
  disabled?: boolean;
  /** Alpha variant: color shown behind the cut-out instead of the checkerboard. */
  backdrop?: string | null;
  /** When set, clicks pick a point (eyedropper) instead of painting. */
  onPick?: (point: Point) => void;
  label: string;
  /** Identifies the image for remembering zoom and pan across modes. */
  zoomKey: string;
};

export const MIN_BRUSH = 2;
/** A touch paints once it moves this far (CSS px) or stays down this long, so a two-finger pinch never paints. */
const TOUCH_SLOP = 8;
const TOUCH_DELAY_MS = 90;
export const MAX_BRUSH = 800;

export const defaultBrushSize = (bitmap: { width: number; height: number }): number =>
  Math.round(Math.min(MAX_BRUSH, Math.max(8, Math.min(bitmap.width, bitmap.height) / 30)));

const stamp = (context: CanvasRenderingContext2D, point: Point, brush: BrushSettings) => {
  const radius = brush.size / 2;
  context.globalCompositeOperation = brush.erase ? 'destination-out' : 'source-over';
  if (brush.soft) {
    const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
  } else {
    context.fillStyle = '#ffffff';
  }
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
};

const growRect = (rect: Rect | null, point: Point, radius: number): Rect => {
  const left = point.x - radius;
  const top = point.y - radius;
  const right = point.x + radius;
  const bottom = point.y + radius;
  if (!rect) return { x: left, y: top, width: right - left, height: bottom - top };
  const x = Math.min(rect.x, left);
  const y = Math.min(rect.y, top);
  return { x, y, width: Math.max(rect.x + rect.width, right) - x, height: Math.max(rect.y + rect.height, bottom) - y };
};

/**
 * Brush editor over the image, shared by Retouch (fill mask) and Background (alpha refinement).
 * The mask lives at source resolution and is displayed through the same view transform as the crop editor.
 */
export const MaskEditor = ({ bitmap, transform, mask, variant, brush, onBrushChange, version, onStrokeEnd, onStrokeAbort, disabled = false, backdrop = null, onPick, label, zoomKey }: MaskEditorProps) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const image = useMemo(() => transformedSize(bitmap, transform.rotation), [bitmap, transform.rotation]);
  const { view, controls } = useZoomView(containerRef, {
    image,
    memoryKey: `${zoomKey}:${image.width}x${image.height}`,
    onPinchStart: () => {
      pendingTouch.current = null;
      const current = stroke.current;
      stroke.current = null;
      if (current?.rect) onStrokeAbort?.(current.rect);
      scheduleRedraw();
    },
  });
  /** A finger that is down but hasn't painted yet: it may still become half of a pinch. */
  const pendingTouch = useRef<{ pointerId: number; point: Point; clientX: number; clientY: number; at: number } | null>(null);
  const maskContext = useMemo(() => mask.getContext('2d', { willReadFrequently: true }), [mask]);
  const stroke = useRef<{ pointerId: number; last: Point; rect: Rect | null } | null>(null);
  const frame = useRef<number | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [keyboardCursor, setKeyboardCursor] = useState<Point | null>(null);

  const redraw = useCallback(() => {
    frame.current = null;
    const overlay = overlayRef.current;
    if (!overlay || !view) return;
    // Only the on-screen part is drawn, so a stroke stays cheap at any zoom.
    const prepared = prepareVisibleCanvas(overlay, view);
    if (!prepared) return;
    const { context } = prepared;
    // The mask edge stays smooth even when the image shows hard pixels.
    context.imageSmoothingEnabled = variant === 'mask' || view.deviceScale < 2;
    if (variant === 'mask') {
      drawTransformed(context, mask, transform, view.deviceScale);
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = getComputedStyle(overlay).getPropertyValue('--color-accent').trim() || '#3d5fd9';
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillRect(0, 0, overlay.width, overlay.height);
    } else {
      drawTransformed(context, bitmap, transform, view.deviceScale);
      context.globalCompositeOperation = 'destination-in';
      drawTransformed(context, mask, transform, view.deviceScale);
    }
    context.globalCompositeOperation = 'source-over';
  }, [view, variant, mask, bitmap, transform]);

  const scheduleRedraw = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(redraw);
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw, version]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  // Brush shortcuts while this editor is on screen. Undo/redo is global (see state/history).
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTextEntryTarget(event.target) || document.querySelector('dialog[open]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier || event.altKey) return;
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const factor = event.key === ']' ? 1.2 : 1 / 1.2;
        onBrushChange({ ...brush, size: Math.round(Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, brush.size * factor))) });
        return;
      }
      if (key === 'x') onBrushChange({ ...brush, erase: !brush.erase });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [brush, onBrushChange]);

  const toSourcePoint = (clientX: number, clientY: number): Point | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !view) return null;
    const displayed = screenToSource(view, { x: clientX - rect.left, y: clientY - rect.top });
    return transformedToSource(displayed, bitmap, transform);
  };

  const paintTo = (point: Point) => {
    const current = stroke.current;
    if (!current || !maskContext) return;
    const distance = Math.hypot(point.x - current.last.x, point.y - current.last.y);
    const spacing = Math.max(1, brush.size / 6);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const at = { x: current.last.x + (point.x - current.last.x) * t, y: current.last.y + (point.y - current.last.y) * t };
      stamp(maskContext, at, brush);
      current.rect = growRect(current.rect, at, brush.size / 2 + 1);
    }
    current.last = point;
    scheduleRedraw();
  };

  const startStroke = (point: Point, pointerId: number) => {
    if (!maskContext || disabled) return;
    stamp(maskContext, point, brush);
    stroke.current = { pointerId, last: point, rect: growRect(null, point, brush.size / 2 + 1) };
    scheduleRedraw();
  };

  const endStroke = () => {
    const current = stroke.current;
    stroke.current = null;
    if (current?.rect) onStrokeEnd(current.rect);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = toSourcePoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    if (onPick) {
      onPick(point);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      pendingTouch.current = { pointerId: event.pointerId, point, clientX: event.clientX, clientY: event.clientY, at: event.timeStamp };
      return;
    }
    startStroke(point, event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const pending = pendingTouch.current;
    if (pending?.pointerId === event.pointerId) {
      // Start painting once the finger clearly moves or stays down: fingers of a pinch land within a few frames.
      const moved = Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY);
      if (moved < TOUCH_SLOP && event.timeStamp - pending.at < TOUCH_DELAY_MS) return;
      pendingTouch.current = null;
      startStroke(pending.point, pending.pointerId);
    }
    if (stroke.current?.pointerId !== event.pointerId) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const coalesced of events.length > 0 ? events : [event.nativeEvent]) {
      const point = toSourcePoint(coalesced.clientX, coalesced.clientY);
      if (point) paintTo(point);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const pending = pendingTouch.current;
    if (pending?.pointerId === event.pointerId) {
      // A tap: one dab.
      pendingTouch.current = null;
      if (event.type === 'pointerup') {
        startStroke(pending.point, pending.pointerId);
        endStroke();
      }
      return;
    }
    if (stroke.current?.pointerId !== event.pointerId) return;
    endStroke();
  };

  /** Keyboard painting: arrows move a brush cursor, Space or Enter paints a dab there. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const current = keyboardCursor ?? { x: image.width / 2, y: image.height / 2 };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const step = Math.max(1, Math.round(brush.size / (event.shiftKey ? 1 : 4)));
      setKeyboardCursor({
        x: Math.min(image.width, Math.max(0, current.x + move.x * step)),
        y: Math.min(image.height, Math.max(0, current.y + move.y * step)),
      });
      return;
    }
    // Space is for panning (Space+drag) until the arrow keys have placed a brush cursor.
    if (event.key !== 'Enter' && !(event.key === ' ' && keyboardCursor)) return;
    event.preventDefault();
    setKeyboardCursor(current);
    const point = transformedToSource(current, bitmap, transform);
    if (onPick) {
      onPick(point);
      return;
    }
    startStroke(point, -1);
    endStroke();
  };

  const cursorSize = view ? brush.size * view.scale : 0;
  const keyboardScreen = view && keyboardCursor ? { x: view.offsetX + keyboardCursor.x * view.scale, y: view.offsetY + keyboardCursor.y * view.scale } : null;

  const panning = controls.panMode !== 'idle';

  return (
    <>
      <div
        ref={containerRef}
        role="application"
        aria-roledescription={t.brush.canvasRole}
        aria-label={t.brush.canvas(label, variant === 'alpha')}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setKeyboardCursor(null)}
        aria-busy={disabled}
        className={cn('absolute inset-0 touch-none overflow-hidden select-none', focusRing, '-outline-offset-2', {
          'cursor-crosshair': Boolean(onPick),
          'cursor-none': !onPick && !disabled,
          'cursor-progress': disabled && !onPick,
        }, panCursor(controls))}
      >
        {view ? (
          <>
            {variant === 'alpha' ? (
              <div
                aria-hidden="true"
                className={cn('absolute', { [checkerboardClass]: !backdrop })}
                // The backdrop is a user-chosen runtime color, so it can't be a Tailwind class.
                style={{ left: view.offsetX, top: view.offsetY, width: view.displayWidth, height: view.displayHeight, backgroundColor: backdrop ?? undefined }}
              />
            ) : null}
            {/* In alpha mode a faint ghost of the removed area helps aim the Restore brush. */}
            <ImageCanvas bitmap={bitmap} transform={transform} view={view} className={cn({ 'opacity-15': variant === 'alpha' })} />
            <canvas
              ref={overlayRef}
              aria-hidden="true"
              className={cn('pointer-events-none absolute', { 'opacity-50': variant === 'mask' })}
              style={{ position: 'absolute', ...boxStyle(visibleRect(view)) }}
            />
            {cursor && !onPick && !panning ? (
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45),inset_0_0_0_1px_rgb(0_0_0/0.45)]',
                  { 'border-dashed': brush.erase, 'opacity-40': disabled },
                )}
                style={{ left: cursor.x, top: cursor.y, width: cursorSize, height: cursorSize }}
              />
            ) : null}
            {keyboardScreen ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
                style={{ left: keyboardScreen.x, top: keyboardScreen.y, width: Math.max(8, cursorSize), height: Math.max(8, cursorSize) }}
              />
            ) : null}
          </>
        ) : null}
      </div>
      <ZoomControl controls={controls} />
    </>
  );
};

/** The mask's alpha channel as one byte per pixel, for the whole mask or just `region`. */
export const readMask = (mask: HTMLCanvasElement, region: Rect = { x: 0, y: 0, width: mask.width, height: mask.height }): Uint8Array => {
  const context = mask.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is not available.');
  const { data } = context.getImageData(region.x, region.y, region.width, region.height);
  const values = new Uint8Array(region.width * region.height);
  for (let index = 0; index < values.length; index += 1) values[index] = data[index * 4 + 3] as number;
  return values;
};

/** Creates a source-sized mask canvas, optionally initialized from alpha bytes. */
export const createMaskCanvas = (width: number, height: number, alpha?: Uint8Array): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (!alpha) return canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  const pixels = context.createImageData(width, height);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    pixels.data[offset] = 255;
    pixels.data[offset + 1] = 255;
    pixels.data[offset + 2] = 255;
    pixels.data[offset + 3] = alpha[index] as number;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
};
