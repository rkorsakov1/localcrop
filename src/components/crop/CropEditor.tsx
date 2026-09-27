import { useMemo, useRef } from 'react';
import { computeAutoCrop, resolveOutputGeometry, targetAspect, transformedSize } from '../../lib/cropMath';
import type { Preset, QueueItem } from '../../lib/types';
import { useZoomView } from '../../hooks/useZoomView';
import { cn } from '../../lib/cn';
import { useApp } from '../../state/AppContext';
import { useT } from '../../i18n/useT';
import { panCursor, ZoomControl } from '../layout/Stage';
import { CropBox } from './CropBox';
import { ImageCanvas } from './ImageCanvas';

type CropEditorProps = { item: QueueItem; preset: Preset };

export const CropEditor = ({ item, preset }: CropEditorProps) => {
  const { state, dispatch } = useApp();
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const bitmap = item.editedBitmap ?? item.sourceBitmap;
  const image = useMemo(() => transformedSize(bitmap, item.transform.rotation), [bitmap, item.transform.rotation]);
  const contain = preset.fit === 'contain' && preset.width !== null && preset.height !== null;
  const geometry = useMemo(() => resolveOutputGeometry(image, item.crop, preset), [image, item.crop, preset]);

  // In contain mode the view shows the output frame; otherwise the whole image.
  const frame = useMemo(
    () => (contain ? { width: geometry.outWidth, height: geometry.outHeight } : image),
    [contain, geometry.outWidth, geometry.outHeight, image],
  );
  const zoomFit = useRef(true);
  const { view, controls } = useZoomView(containerRef, {
    image: frame,
    memoryKey: `${item.id}:${frame.width}x${frame.height}`,
    // Once zoomed in, dragging anywhere outside the crop box pans.
    panWithPrimary: (event) => !zoomFit.current && !(event.target instanceof Element && event.target.closest('[data-crop-box]')),
  });
  zoomFit.current = controls.isFit;
  const aspect = targetAspect(preset);
  const crop = item.crop ?? computeAutoCrop(image, aspect);

  return (
    <>
      <div ref={containerRef} className={cn('absolute inset-0 touch-none overflow-hidden select-none', { 'cursor-grab': !controls.isFit }, panCursor(controls))}>
        {view && !contain ? (
          <>
            <ImageCanvas bitmap={bitmap} transform={item.transform} view={view} />
            {/* Dims the image outside the crop, and only the image (not the stage around it). */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute overflow-hidden"
              style={{ left: view.offsetX, top: view.offsetY, width: view.displayWidth, height: view.displayHeight }}
            >
              <div
                className="absolute shadow-[0_0_0_9999px_var(--color-dim)]"
                style={{ left: crop.x * view.scale, top: crop.y * view.scale, width: crop.width * view.scale, height: crop.height * view.scale }}
              />
            </div>
            <CropBox
              crop={crop}
              bounds={image}
              aspect={aspect}
              view={view}
              containerRef={containerRef}
              showThirds={state.prefs.showThirds}
              onChange={(next, gesture) => dispatch({ type: 'setCrop', id: item.id, crop: next, gesture })}
              onReset={() => dispatch({ type: 'setCrop', id: item.id, crop: null })}
            />
          </>
        ) : null}

        {view && contain ? (
          <>
            {/* The matte is a user-chosen runtime color, so it can't be a Tailwind class. */}
            <div
              aria-hidden="true"
              className="absolute shadow-float"
              style={{
                left: view.offsetX,
                top: view.offsetY,
                width: view.displayWidth,
                height: view.displayHeight,
                backgroundColor: preset.matteColor,
              }}
            />
            <ImageCanvas
              bitmap={bitmap}
              transform={item.transform}
              view={{
                ...view,
                offsetX: view.offsetX + geometry.drawRect.x * view.scale,
                offsetY: view.offsetY + geometry.drawRect.y * view.scale,
                scale: view.scale * (geometry.drawRect.width / image.width),
                deviceScale: view.deviceScale * (geometry.drawRect.width / image.width),
                displayWidth: geometry.drawRect.width * view.scale,
                displayHeight: geometry.drawRect.height * view.scale,
              }}
            />
            <p className="sr-only" aria-live="polite">
              {t.crop.containNote(geometry.outWidth, geometry.outHeight)}
            </p>
          </>
        ) : null}
      </div>
      <ZoomControl controls={controls} />
    </>
  );
};
