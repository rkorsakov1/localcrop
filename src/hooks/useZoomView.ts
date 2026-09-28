import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fitZoom, type Point, type Size } from '../lib/cropMath';
import { isTextEntryTarget } from './useKeyboardShortcuts';
import { useViewTransform } from './useViewTransform';

type ZoomState = { zoom: 'fit' | number; pan: Point };

const FIT: ZoomState = { zoom: 'fit', pan: { x: 0, y: 0 } };
/** Zoom and pan per image, so switching between Crop, Retouch and Background keeps the view. */
const remembered = new Map<string, ZoomState>();

export const MAX_ZOOM = 32;
/** Keyboard and button steps, in device pixels per source pixel (1 = 100%). */
const STEPS = [0.05, 0.1, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export type PanMode = 'idle' | 'ready' | 'dragging';

export type ZoomControls = {
  /** Current zoom, 1 = one screen pixel per image pixel. */
  zoom: number;
  isFit: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  /** Zooms to a level around the center. */
  setZoom: (zoom: number) => void;
  /** 'ready' while Space is held over the stage: a drag pans instead of editing. */
  panMode: PanMode;
};

type Options = {
  image: Size;
  padding?: number;
  /** Zoom and pan are kept per key (e.g. image id + size); a new key starts fitted unless it was seen before. */
  memoryKey: string;
  /** Primary-button drags that should pan instead of reaching the editor (middle button and Space+drag always pan). */
  panWithPrimary?: (event: PointerEvent) => boolean;
  /** A second finger turned a touch into a pinch: the editor should drop what the first finger started. */
  onPinchStart?: () => void;
};

/**
 * Zoom and pan for a stage, like other image editors: Ctrl/⌘ + wheel or pinch zooms at the pointer,
 * the wheel pans once zoomed in, Ctrl/⌘ + = / − / 0 zoom from the keyboard, Space+drag or a middle-button drag pans,
 * and on touch screens two fingers pinch to zoom and drag to pan.
 */
export const useZoomView = (containerRef: RefObject<HTMLElement | null>, { image, padding = 24, memoryKey, panWithPrimary, onPinchStart }: Options) => {
  const [keyed, setKeyed] = useState(() => ({ key: memoryKey, state: remembered.get(memoryKey) ?? FIT }));
  if (keyed.key !== memoryKey) setKeyed({ key: memoryKey, state: remembered.get(memoryKey) ?? FIT });
  const state = keyed.key === memoryKey ? keyed.state : (remembered.get(memoryKey) ?? FIT);
  const { view, container, devicePixelRatio } = useViewTransform(containerRef, { image, zoom: state.zoom, pan: state.pan, padding });
  const [panMode, setPanMode] = useState<PanMode>('idle');

  const fitted = container.width > 0 && image.width > 0 ? fitZoom(container, image, devicePixelRatio, padding) : 1;
  const zoom = state.zoom === 'fit' ? fitted : state.zoom;

  // Handlers attached once read the latest values from here.
  const latest = useRef({ image, container, devicePixelRatio, padding, fitted, zoom, state, memoryKey, panWithPrimary, onPinchStart });
  latest.current = { image, container, devicePixelRatio, padding, fitted, zoom, state, memoryKey, panWithPrimary, onPinchStart };

  useEffect(() => {
    if (state === FIT) remembered.delete(memoryKey);
    else remembered.set(memoryKey, state);
  }, [state, memoryKey]);

  const clampPan = useCallback((pan: Point, zoomValue: number): Point => {
    const { image: size, container: box, devicePixelRatio: ratio, padding: pad } = latest.current;
    const scale = zoomValue / ratio;
    const limit = (display: number, available: number) => (display > available - pad * 2 ? (display - available) / 2 + pad : 0);
    const limitX = limit(size.width * scale, box.width);
    const limitY = limit(size.height * scale, box.height);
    return { x: Math.min(limitX, Math.max(-limitX, pan.x)), y: Math.min(limitY, Math.max(-limitY, pan.y)) };
  }, []);

  const apply = useCallback((next: ZoomState) => setKeyed({ key: latest.current.memoryKey, state: next }), []);

  const clampZoom = useCallback((target: number) => {
    const fitValue = latest.current.fitted;
    return Math.min(Math.max(MAX_ZOOM, fitValue), Math.max(Math.min(fitValue / 2, 1), target));
  }, []);

  /** The image point (source px) currently under `at` (container px). */
  const sourceAt = useCallback((at: Point): Point => {
    const { image: size, container: box, devicePixelRatio: ratio, zoom: current, state: now } = latest.current;
    const scale = current / ratio;
    const pan = now.zoom === 'fit' ? { x: 0, y: 0 } : now.pan;
    return {
      x: (at.x - (box.width - size.width * scale) / 2 - pan.x) / scale,
      y: (at.y - (box.height - size.height * scale) / 2 - pan.y) / scale,
    };
  }, []);

  /** Zooms to `zoomValue` with image point `source` shown at `at` (container px). */
  const place = useCallback(
    (zoomValue: number, source: Point, at: Point) => {
      const { image: size, container: box, devicePixelRatio: ratio } = latest.current;
      const scale = zoomValue / ratio;
      const pan = {
        x: at.x - source.x * scale - (box.width - size.width * scale) / 2,
        y: at.y - source.y * scale - (box.height - size.height * scale) / 2,
      };
      apply({ zoom: zoomValue, pan: clampPan(pan, zoomValue) });
    },
    [apply, clampPan],
  );

  /** Zooms to `target`, keeping the image point under `anchor` (container px; default: the center) in place. */
  const zoomTo = useCallback(
    (target: number, anchor?: Point) => {
      const { container: box, fitted: fitValue } = latest.current;
      if (box.width === 0) return;
      const next = clampZoom(target);
      if (Math.abs(next - fitValue) / fitValue < 0.01) {
        apply(FIT);
        return;
      }
      const at = anchor ?? { x: box.width / 2, y: box.height / 2 };
      place(next, sourceAt(at), at);
    },
    [apply, clampZoom, place, sourceAt],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const { state: now, zoom: current } = latest.current;
      if (now.zoom === 'fit') return;
      apply({ zoom: now.zoom, pan: clampPan({ x: now.pan.x + dx, y: now.pan.y + dy }, current) });
    },
    [apply, clampPan],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const current = latest.current.zoom;
      const candidates = [...STEPS, latest.current.fitted].sort((a, b) => a - b);
      const next = direction > 0 ? candidates.find((value) => value > current * 1.01) : candidates.reverse().find((value) => value < current / 1.01);
      if (next !== undefined) zoomTo(next);
    },
    [zoomTo],
  );

  const zoomIn = useCallback(() => step(1), [step]);
  const zoomOut = useCallback(() => step(-1), [step]);
  const fit = useCallback(() => apply(FIT), [apply]);
  const actualSize = useCallback(() => zoomTo(1), [zoomTo]);

  // Wheel, Space+drag and middle-button panning on the stage.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let hovering = false;
    let spaceHeld = false;
    let drag: { pointerId: number; x: number; y: number } | null = null;

    const handleWheel = (event: WheelEvent) => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? latest.current.container.height : 1;
      const rect = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        // Also what a trackpad pinch sends. Stops the browser from zooming the whole page.
        event.preventDefault();
        const delta = Math.max(-50, Math.min(50, event.deltaY * unit));
        zoomTo(latest.current.zoom * Math.exp(-delta * 0.004), { x: event.clientX - rect.left, y: event.clientY - rect.top });
        return;
      }
      if (latest.current.state.zoom === 'fit') return;
      event.preventDefault();
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      panBy(-dx * unit, -dy * unit);
    };

    // Two-finger pinch: zooms around the midpoint, and moving both fingers pans.
    const touches = new Map<number, Point>();
    /** Fingers that took part in a pinch; their events stay away from the editor until they lift. */
    const consumed = new Set<number>();
    let pinch: { ids: [number, number]; distance: number; zoom: number; source: Point } | null = null;
    const local = (event: PointerEvent): Point => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pinchGeometry = (): { mid: Point; distance: number } | null => {
      if (!pinch) return null;
      const a = touches.get(pinch.ids[0]);
      const b = touches.get(pinch.ids[1]);
      if (!a || !b) return null;
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };

    const handleTouchDown = (event: PointerEvent): boolean => {
      if (event.pointerType !== 'touch') return false;
      touches.set(event.pointerId, local(event));
      if (pinch || touches.size !== 2) return pinch !== null;
      const [first, second] = [...touches.keys()] as [number, number];
      pinch = { ids: [first, second], distance: 1, zoom: latest.current.zoom, source: { x: 0, y: 0 } };
      const geometry = pinchGeometry();
      if (!geometry) return false;
      pinch = { ...pinch, distance: geometry.distance, source: sourceAt(geometry.mid) };
      consumed.add(first);
      consumed.add(second);
      latest.current.onPinchStart?.();
      element.setPointerCapture(event.pointerId);
      return true;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (handleTouchDown(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const primaryPans = event.button === 0 && (spaceHeld || (latest.current.panWithPrimary?.(event) ?? false));
      if (event.button !== 1 && !primaryPans) return;
      // Before the editor sees it: no brush stroke or crop drag starts.
      event.preventDefault();
      event.stopPropagation();
      element.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      setPanMode('dragging');
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (touches.has(event.pointerId)) touches.set(event.pointerId, local(event));
      if (consumed.has(event.pointerId)) {
        event.stopPropagation();
        const geometry = pinchGeometry();
        if (pinch && geometry) place(clampZoom((pinch.zoom * geometry.distance) / pinch.distance), pinch.source, geometry.mid);
        return;
      }
      if (drag?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      panBy(event.clientX - drag.x, event.clientY - drag.y);
      drag = { ...drag, x: event.clientX, y: event.clientY };
    };

    const handlePointerUp = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      if (consumed.has(event.pointerId)) {
        event.stopPropagation();
        consumed.delete(event.pointerId);
        if (pinch?.ids.includes(event.pointerId)) {
          pinch = null;
          // Close enough to "fit" snaps back to it, as the buttons and wheel do.
          const { zoom: current, fitted: fitValue } = latest.current;
          if (Math.abs(current - fitValue) / fitValue < 0.03) apply(FIT);
        }
        return;
      }
      if (drag?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      drag = null;
      setPanMode(spaceHeld ? 'ready' : 'idle');
    };

    const handleEnter = () => {
      hovering = true;
    };
    const handleLeave = () => {
      hovering = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target) || document.querySelector('dialog[open]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.altKey) {
        if (event.key === '=' || event.key === '+' || event.code === 'NumpadAdd') {
          event.preventDefault();
          step(1);
        } else if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
          event.preventDefault();
          step(-1);
        } else if (event.key === '0' || event.code === 'Numpad0') {
          event.preventDefault();
          apply(FIT);
        }
        return;
      }
      if (event.shiftKey && !event.altKey && (event.code === 'Digit0' || event.code === 'Digit1')) {
        // Figma-style: Shift+0 = 100%, Shift+1 = fit.
        event.preventDefault();
        if (event.code === 'Digit0') zoomTo(1);
        else apply(FIT);
        return;
      }
      if (event.code === 'Space' && hovering && !event.repeat && !modifier) {
        event.preventDefault();
        spaceHeld = true;
        if (!drag) setPanMode('ready');
      } else if (event.code === 'Space' && spaceHeld) {
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceHeld) return;
      spaceHeld = false;
      if (!drag) setPanMode('idle');
    };

    const handleBlur = () => {
      spaceHeld = false;
      if (!drag) setPanMode('idle');
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('pointerdown', handlePointerDown, { capture: true });
    element.addEventListener('pointermove', handlePointerMove, { capture: true });
    element.addEventListener('pointerup', handlePointerUp, { capture: true });
    element.addEventListener('pointercancel', handlePointerUp, { capture: true });
    element.addEventListener('pointerenter', handleEnter);
    element.addEventListener('pointerleave', handleLeave);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      element.removeEventListener('pointermove', handlePointerMove, { capture: true });
      element.removeEventListener('pointerup', handlePointerUp, { capture: true });
      element.removeEventListener('pointercancel', handlePointerUp, { capture: true });
      element.removeEventListener('pointerenter', handleEnter);
      element.removeEventListener('pointerleave', handleLeave);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [containerRef, zoomTo, panBy, step, apply, place, clampZoom, sourceAt]);

  const controls: ZoomControls = { zoom, isFit: state.zoom === 'fit', zoomIn, zoomOut, fit, actualSize, setZoom: zoomTo, panMode };
  return { view, container, devicePixelRatio, controls };
};
