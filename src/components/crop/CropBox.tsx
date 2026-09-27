import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { cn } from '../../lib/cn';
import {
  moveCrop,
  resizeCropFromCorner,
  scaleCropAroundCenter,
  screenToSource,
  type Corner,
  type Point,
  type Size,
  type ViewTransform,
} from '../../lib/cropMath';
import type { CropRect } from '../../lib/types';
import { useT } from '../../i18n/useT';

type Drag = { pointerId: number; kind: 'move' | Corner; start: Point; startCrop: CropRect; gesture: string };

type CropBoxProps = {
  crop: CropRect;
  bounds: Size;
  aspect: number | null;
  view: ViewTransform;
  containerRef: RefObject<HTMLElement | null>;
  showThirds: boolean;
  /** `gesture` identifies one pointer drag, so the whole drag is a single undo step. */
  onChange: (crop: CropRect, gesture?: string) => void;
  onReset: () => void;
};

// Each handle is a 44px touch target centered on the corner; inside it, the visible 20px
// L-bracket sits 3px outside the crop edge.
const CORNERS: { corner: Corner; hit: string; bracket: string }[] = [
  { corner: 'nw', hit: '-left-5.5 -top-5.5 cursor-nwse-resize', bracket: 'left-[19px] top-[19px] border-t-4 border-l-4' },
  { corner: 'ne', hit: '-right-5.5 -top-5.5 cursor-nesw-resize', bracket: 'right-[19px] top-[19px] border-t-4 border-r-4' },
  { corner: 'sw', hit: '-bottom-5.5 -left-5.5 cursor-nesw-resize', bracket: 'bottom-[19px] left-[19px] border-b-4 border-l-4' },
  { corner: 'se', hit: '-bottom-5.5 -right-5.5 cursor-nwse-resize', bracket: 'bottom-[19px] right-[19px] border-b-4 border-r-4' },
];

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const cornerPoint = (crop: CropRect, corner: Corner): Point => ({
  x: corner === 'nw' || corner === 'sw' ? crop.x : crop.x + crop.width,
  y: corner === 'nw' || corner === 'ne' ? crop.y : crop.y + crop.height,
});

export const ThirdsOverlay = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0">
    <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
    <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
    <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
    <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
  </div>
);

/** Movable, resizable crop rectangle. All geometry is in source pixels; `view` maps it to the screen. */
export const CropBox = ({ crop, bounds, aspect, view, containerRef, showThirds, onChange, onReset }: CropBoxProps) => {
  const t = useT();
  const drag = useRef<Drag | null>(null);

  const toSource = (event: PointerEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return screenToSource(view, { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { pointerId: event.pointerId, kind, start: toSource(event), startCrop: crop, gesture: crypto.randomUUID() };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = toSource(event);
    if (current.kind === 'move') {
      onChange(moveCrop(current.startCrop, point.x - current.start.x, point.y - current.start.y, bounds), current.gesture);
      return;
    }
    // Shift keeps the box's current shape when the ratio isn't locked.
    const shape = aspect ?? (event.shiftKey ? current.startCrop.width / current.startCrop.height : null);
    onChange(resizeCropFromCorner(current.startCrop, current.kind, point, shape, bounds), current.gesture);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleBoxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      onChange(moveCrop(crop, arrow.x * step, arrow.y * step, bounds));
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      onChange(scaleCropAroundCenter(crop, 1.02, bounds));
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      onChange(scaleCropAroundCenter(crop, 1 / 1.02, bounds));
    }
  };

  const handleCornerKeyDown = (event: KeyboardEvent<HTMLDivElement>, corner: Corner) => {
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const point = cornerPoint(crop, corner);
    onChange(resizeCropFromCorner(crop, corner, { x: point.x + arrow.x * step, y: point.y + arrow.y * step }, aspect, bounds));
  };

  const left = view.offsetX + crop.x * view.scale;
  const top = view.offsetY + crop.y * view.scale;
  const width = crop.width * view.scale;
  const height = crop.height * view.scale;

  return (
    <div
      role="group"
      data-crop-box
      aria-roledescription={t.crop.areaRole}
      aria-label={t.crop.area(Math.round(crop.width), Math.round(crop.height), Math.round(crop.x), Math.round(crop.y))}
      tabIndex={0}
      onPointerDown={(event) => handlePointerDown(event, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleBoxKeyDown}
      className={cn(
        'group absolute cursor-move touch-none outline outline-1 outline-white',
        'focus-visible:outline-2 focus-visible:outline-accent',
      )}
      style={{ left, top, width, height }}
    >
      {showThirds ? <ThirdsOverlay /> : null}
      {CORNERS.map(({ corner, hit, bracket }) => (
        <div
          key={corner}
          role="button"
          aria-roledescription={t.crop.handleRole}
          aria-label={t.crop.handle(t.crop.corners[corner])}
          tabIndex={0}
          onPointerDown={(event) => handlePointerDown(event, corner)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={(event) => handleCornerKeyDown(event, corner)}
          className={cn('peer absolute size-11 touch-none outline-none', hit)}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute size-5 border-white drop-shadow-[0_0_1px_rgb(0_0_0/.5)]',
              'group-focus-visible:border-accent in-focus-visible:border-accent',
              bracket,
            )}
          />
        </div>
      ))}
    </div>
  );
};
