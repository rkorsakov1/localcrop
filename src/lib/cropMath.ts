import type { CropRect, EncodeSettings, Rotation, Transform } from './types';

export const MIN_CROP_SIZE = 16;

export type Size = { width: number; height: number };
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type Point = { x: number; y: number };

export const IDENTITY_TRANSFORM: Transform = { rotation: 0, flipH: false, flipV: false };

/** Size of the image after rotation (flips don't change size). */
export const transformedSize = (source: Size, rotation: Rotation): Size => {
  if (rotation === 90 || rotation === 270) return { width: source.height, height: source.width };
  return { width: source.width, height: source.height };
};

export const rotateTransform = (transform: Transform, direction: 'left' | 'right'): Transform => {
  const delta = direction === 'right' ? 90 : 270;
  return { ...transform, rotation: ((transform.rotation + delta) % 360) as Rotation };
};

/**
 * The target aspect ratio the crop box is locked to, or null for free aspect.
 * Only cover mode with both dimensions set has a fixed aspect.
 */
export const targetAspect = (settings: Pick<EncodeSettings, 'width' | 'height' | 'fit'>): number | null => {
  if (settings.fit !== 'cover') return null;
  if (!settings.width || !settings.height) return null;
  return settings.width / settings.height;
};

/** Largest centered rectangle of `aspect` inside the image; the full image when aspect is null. */
export const computeAutoCrop = (image: Size, aspect: number | null): CropRect => {
  if (aspect === null) return { x: 0, y: 0, width: image.width, height: image.height };
  if (image.width / image.height > aspect) {
    const width = image.height * aspect;
    return { x: (image.width - width) / 2, y: 0, width, height: image.height };
  }
  const height = image.width / aspect;
  return { x: 0, y: (image.height - height) / 2, width: image.width, height };
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Keeps the rectangle's size (shrinking only if it's larger than the image) and moves it inside the bounds. */
export const clampCropToBounds = (crop: CropRect, bounds: Size): CropRect => {
  const width = Math.min(crop.width, bounds.width);
  const height = Math.min(crop.height, bounds.height);
  return {
    x: clamp(crop.x, 0, bounds.width - width),
    y: clamp(crop.y, 0, bounds.height - height),
    width,
    height,
  };
};

export const moveCrop = (crop: CropRect, dx: number, dy: number, bounds: Size): CropRect =>
  clampCropToBounds({ ...crop, x: crop.x + dx, y: crop.y + dy }, bounds);

const anchorFor = (crop: CropRect, corner: Corner): Point => ({
  x: corner === 'nw' || corner === 'sw' ? crop.x + crop.width : crop.x,
  y: corner === 'nw' || corner === 'ne' ? crop.y + crop.height : crop.y,
});

/**
 * Resizes from a corner handle towards `pointer`, anchored at the opposite corner.
 * With an aspect ratio the box stays locked to it; the minimum size is MIN_CROP_SIZE
 * on both sides (or the image size if the image is smaller).
 */
export const resizeCropFromCorner = (
  crop: CropRect,
  corner: Corner,
  pointer: Point,
  aspect: number | null,
  bounds: Size,
): CropRect => {
  const anchor = anchorFor(crop, corner);
  const growsLeft = corner === 'nw' || corner === 'sw';
  const growsUp = corner === 'nw' || corner === 'ne';
  const maxWidth = growsLeft ? anchor.x : bounds.width - anchor.x;
  const maxHeight = growsUp ? anchor.y : bounds.height - anchor.y;

  let width = Math.abs(pointer.x - anchor.x);
  let height = Math.abs(pointer.y - anchor.y);

  if (aspect === null) {
    width = clamp(width, Math.min(MIN_CROP_SIZE, maxWidth), maxWidth);
    height = clamp(height, Math.min(MIN_CROP_SIZE, maxHeight), maxHeight);
  } else {
    // Follow whichever axis the pointer has moved further along, relative to the aspect.
    width = Math.max(width, height * aspect);
    const maxLockedWidth = Math.min(maxWidth, maxHeight * aspect);
    const minLockedWidth = Math.min(Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * aspect), maxLockedWidth);
    width = clamp(width, minLockedWidth, maxLockedWidth);
    height = width / aspect;
  }

  return {
    x: growsLeft ? anchor.x - width : anchor.x,
    y: growsUp ? anchor.y - height : anchor.y,
    width,
    height,
  };
};

/** Scales around the center (keyboard +/-), keeping the aspect and staying inside the image. */
export const scaleCropAroundCenter = (crop: CropRect, factor: number, bounds: Size): CropRect => {
  const aspect = crop.width / crop.height;
  const maxWidth = Math.min(bounds.width, bounds.height * aspect);
  const minWidth = Math.min(Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * aspect), maxWidth);
  const width = clamp(crop.width * factor, minWidth, maxWidth);
  const height = width / aspect;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  return clampCropToBounds({ x: centerX - width / 2, y: centerY - height / 2, width, height }, bounds);
};

/**
 * Reshapes a crop to `aspect` around its center, keeping roughly the same area, then fits it
 * inside the image. Used when the target ratio changes, so the selection doesn't jump away.
 */
export const adaptCropToAspect = (crop: CropRect, aspect: number, bounds: Size): CropRect => {
  let width = Math.sqrt(crop.width * crop.height * aspect);
  let height = width / aspect;
  const shrink = Math.min(1, bounds.width / width, bounds.height / height);
  width *= shrink;
  height *= shrink;
  const minWidth = Math.min(Math.max(MIN_CROP_SIZE, MIN_CROP_SIZE * aspect), bounds.width, bounds.height * aspect);
  if (width < minWidth) {
    width = minWidth;
    height = width / aspect;
  }
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  return clampCropToBounds({ x: centerX - width / 2, y: centerY - height / 2, width, height }, bounds);
};

/** Ratios people ask for by name, landscape first; portrait versions are matched too. */
export const COMMON_RATIOS: readonly [number, number][] = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [2, 1],
  [21, 9],
];

/** "16:9", "4:5" for a common ratio (within 0.5%), otherwise "1.47:1" / "1:1.47". */
export const describeRatio = (width: number, height: number): string => {
  if (width <= 0 || height <= 0) return '';
  const ratio = width / height;
  for (const [a, b] of COMMON_RATIOS) {
    if (Math.abs(ratio / (a / b) - 1) < 0.005) return `${a}:${b}`;
    if (Math.abs(ratio / (b / a) - 1) < 0.005) return `${b}:${a}`;
  }
  const format = (value: number) => String(Math.round(value * 100) / 100);
  return ratio >= 1 ? `${format(ratio)}:1` : `1:${format(1 / ratio)}`;
};

/** Rounds a crop to whole source pixels, staying inside bounds. */
export const roundCrop = (crop: CropRect, bounds: Size): CropRect => {
  const x = clamp(Math.round(crop.x), 0, bounds.width - 1);
  const y = clamp(Math.round(crop.y), 0, bounds.height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(crop.width), 1, bounds.width - x),
    height: clamp(Math.round(crop.height), 1, bounds.height - y),
  };
};

export type OutputGeometry = {
  /** Final canvas size. */
  outWidth: number;
  outHeight: number;
  /** Region of the transformed source that is drawn. */
  sourceRect: CropRect;
  /** Where `sourceRect` lands in the output canvas (contain mode pads around it). */
  drawRect: CropRect;
  /** True when the output was reduced because allowUpscale is off. */
  upscaleCapped: boolean;
  /** The size that would have been produced with upscaling allowed. */
  requestedWidth: number;
  requestedHeight: number;
};

const atLeastOne = (value: number): number => Math.max(1, Math.round(value));

/**
 * Resolves the output canvas size and the source/destination rectangles for a job.
 * `image` is the transformed image size; `crop` is ignored in contain mode.
 */
export const resolveOutputGeometry = (
  image: Size,
  crop: CropRect | null,
  settings: Pick<EncodeSettings, 'width' | 'height' | 'fit' | 'allowUpscale'>,
): OutputGeometry => {
  const { width, height, fit, allowUpscale } = settings;

  if (fit === 'contain' && width && height) {
    const scale = Math.min(width / image.width, height / image.height);
    const capped = !allowUpscale && scale > 1;
    const factor = capped ? 1 / scale : 1;
    const effectiveScale = scale * factor;
    const outWidth = atLeastOne(width * factor);
    const outHeight = atLeastOne(height * factor);
    const drawWidth = Math.min(outWidth, atLeastOne(image.width * effectiveScale));
    const drawHeight = Math.min(outHeight, atLeastOne(image.height * effectiveScale));
    return {
      outWidth,
      outHeight,
      sourceRect: { x: 0, y: 0, width: image.width, height: image.height },
      drawRect: {
        x: Math.round((outWidth - drawWidth) / 2),
        y: Math.round((outHeight - drawHeight) / 2),
        width: drawWidth,
        height: drawHeight,
      },
      upscaleCapped: capped,
      requestedWidth: width,
      requestedHeight: height,
    };
  }

  const aspect = targetAspect(settings);
  const sourceRect = roundCrop(crop ?? computeAutoCrop(image, aspect), image);

  let requestedWidth = sourceRect.width;
  let requestedHeight = sourceRect.height;
  if (width && height && fit === 'cover') {
    requestedWidth = width;
    requestedHeight = height;
  } else if (width && height && fit === 'free') {
    // Free crop: keep the crop's own shape and fit it inside width × height.
    const fitScale = Math.min(width / sourceRect.width, height / sourceRect.height);
    requestedWidth = atLeastOne(sourceRect.width * fitScale);
    requestedHeight = atLeastOne(sourceRect.height * fitScale);
  } else if (width) {
    requestedWidth = width;
    requestedHeight = atLeastOne((width * sourceRect.height) / sourceRect.width);
  } else if (height) {
    requestedHeight = height;
    requestedWidth = atLeastOne((height * sourceRect.width) / sourceRect.height);
  }

  const scale = Math.min(requestedWidth / sourceRect.width, requestedHeight / sourceRect.height);
  const capped = !allowUpscale && scale > 1;
  const factor = capped ? 1 / scale : 1;
  // When capped, rounding must never push the output past the crop itself (that would upscale).
  const outWidth = capped ? Math.min(sourceRect.width, atLeastOne(requestedWidth * factor)) : atLeastOne(requestedWidth);
  const outHeight = capped ? Math.min(sourceRect.height, atLeastOne(requestedHeight * factor)) : atLeastOne(requestedHeight);

  return {
    outWidth,
    outHeight,
    sourceRect,
    drawRect: { x: 0, y: 0, width: outWidth, height: outHeight },
    upscaleCapped: capped,
    requestedWidth,
    requestedHeight,
  };
};

export type ViewTransform = {
  /** CSS pixels per source pixel. */
  scale: number;
  /** CSS pixel offset of the image's top-left corner inside the container. */
  offsetX: number;
  offsetY: number;
  /** Device pixels per source pixel, for sizing backing canvases. */
  deviceScale: number;
  /** Displayed image size in CSS pixels. */
  displayWidth: number;
  displayHeight: number;
  /** Size of the container the image is shown in, in CSS pixels. */
  viewportWidth: number;
  viewportHeight: number;
};

export type ViewInput = {
  container: Size;
  image: Size;
  /** 'fit' scales the whole image into the container; a number is CSS px per source px / devicePixelRatio (1 = 100%). */
  zoom: 'fit' | number;
  pan?: Point;
  devicePixelRatio: number;
  padding?: number;
};

/** The single place that maps source pixels to screen space. */
export const getViewTransform = ({ container, image, zoom, pan, devicePixelRatio, padding = 0 }: ViewInput): ViewTransform => {
  const availableWidth = Math.max(1, container.width - padding * 2);
  const availableHeight = Math.max(1, container.height - padding * 2);
  const scale =
    zoom === 'fit'
      ? Math.min(availableWidth / image.width, availableHeight / image.height)
      : zoom / devicePixelRatio;
  const displayWidth = image.width * scale;
  const displayHeight = image.height * scale;
  const panX = zoom === 'fit' ? 0 : (pan?.x ?? 0);
  const panY = zoom === 'fit' ? 0 : (pan?.y ?? 0);
  return {
    scale,
    offsetX: (container.width - displayWidth) / 2 + panX,
    offsetY: (container.height - displayHeight) / 2 + panY,
    deviceScale: scale * devicePixelRatio,
    displayWidth,
    displayHeight,
    viewportWidth: container.width,
    viewportHeight: container.height,
  };
};

/** Scale that fits the whole image in the container, as a zoom value (device px per source px). */
export const fitZoom = (container: Size, image: Size, devicePixelRatio: number, padding = 0): number =>
  Math.min(Math.max(1, container.width - padding * 2) / image.width, Math.max(1, container.height - padding * 2) / image.height) * devicePixelRatio;

/** The part of the displayed image that is inside the container (CSS px, container coordinates); null if none is. */
export const visibleRect = (view: ViewTransform): CropRect | null => {
  const left = Math.max(0, Math.floor(view.offsetX));
  const top = Math.max(0, Math.floor(view.offsetY));
  const right = Math.min(view.viewportWidth, Math.ceil(view.offsetX + view.displayWidth));
  const bottom = Math.min(view.viewportHeight, Math.ceil(view.offsetY + view.displayHeight));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const sourceToScreen = (view: ViewTransform, point: Point): Point => ({
  x: view.offsetX + point.x * view.scale,
  y: view.offsetY + point.y * view.scale,
});

export const screenToSource = (view: ViewTransform, point: Point): Point => ({
  x: (point.x - view.offsetX) / view.scale,
  y: (point.y - view.offsetY) / view.scale,
});

/** Limits pan so the image can't be dragged entirely out of view. */
export const clampPan = (pan: Point, container: Size, display: Size): Point => {
  const limitX = Math.max(0, (display.width - container.width) / 2);
  const limitY = Math.max(0, (display.height - container.height) / 2);
  return { x: clamp(pan.x, -limitX, limitX), y: clamp(pan.y, -limitY, limitY) };
};

/** Two crops are equal within half a pixel (avoids re-encoding for sub-pixel noise). */
export const cropsEqual = (a: CropRect | null, b: CropRect | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
};

/**
 * Maps a point in the transformed (rotated/flipped, as displayed) image back to source pixels.
 * Inverse of drawTransformed: rotation first, then flips in the rotated orientation.
 */
export const transformedToSource = (point: Point, source: Size, transform: Transform): Point => {
  const displayed = transformedSize(source, transform.rotation);
  let x = point.x - displayed.width / 2;
  let y = point.y - displayed.height / 2;
  if (transform.flipH) x = -x;
  if (transform.flipV) y = -y;
  const angle = (-transform.rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));
  return {
    x: x * cos - y * sin + source.width / 2,
    y: x * sin + y * cos + source.height / 2,
  };
};
