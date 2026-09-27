import { useEffect, useRef } from 'react';
import { visibleRect, type ViewTransform } from '../../lib/cropMath';
import { drawTransformed, get2d, type Context2D } from '../../lib/drawing';
import type { Transform } from '../../lib/types';

type ImageCanvasProps = {
  bitmap: ImageBitmap;
  transform: Transform;
  view: ViewTransform;
  className?: string;
};

/**
 * Sizes `canvas` to the on-screen part of the image (so zooming in never allocates a huge
 * backing store) and sets `context` up so drawing at `view.deviceScale` lands in place.
 * Returns the CSS box to position the canvas at, or null when nothing is visible.
 */
export const prepareVisibleCanvas = (canvas: HTMLCanvasElement, view: ViewTransform) => {
  const box = visibleRect(view);
  if (!box) return null;
  const ratio = view.deviceScale / view.scale;
  const width = Math.max(1, Math.round(box.width * ratio));
  const height = Math.max(1, Math.round(box.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context: Context2D = get2d(canvas);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, width, height);
  context.translate((view.offsetX - box.x) * ratio, (view.offsetY - box.y) * ratio);
  // Show crisp pixels when zoomed in past 200%.
  context.imageSmoothingEnabled = view.deviceScale < 2;
  context.imageSmoothingQuality = 'high';
  return { context, box };
};

export const boxStyle = (box: { x: number; y: number; width: number; height: number } | null) =>
  box ? { left: box.x, top: box.y, width: box.width, height: box.height } : { display: 'none' };

/** Draws the (transformed) image at the view's size, sharp on high-DPI screens. Only the visible part is drawn. */
export const ImageCanvas = ({ bitmap, transform, view, className }: ImageCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const box = visibleRect(view);

  const { scale, offsetX, offsetY, deviceScale, displayWidth, displayHeight, viewportWidth, viewportHeight } = view;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const current = { scale, offsetX, offsetY, deviceScale, displayWidth, displayHeight, viewportWidth, viewportHeight };
    const prepared = prepareVisibleCanvas(canvas, current);
    if (prepared) drawTransformed(prepared.context, bitmap, transform, deviceScale);
  }, [bitmap, transform, scale, offsetX, offsetY, deviceScale, displayWidth, displayHeight, viewportWidth, viewportHeight]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ position: 'absolute', ...boxStyle(box) }} />;
};
