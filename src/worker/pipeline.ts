// The encode pipeline, independent of where it runs: in the processor worker with
// OffscreenCanvas, or on the main thread with <canvas> when OffscreenCanvas 2D is missing.

import { resolveOutputGeometry, transformedSize } from '../lib/cropMath';
import { drawTransformed, get2d, hasTransparency, isIdentityTransform, type Surface } from '../lib/drawing';
import { FORMAT_LABELS, FORMAT_MIME } from '../lib/format';
import { flatFill, harmonicFill, ringMedianColor } from '../lib/inpaint';
import { findQualityForTarget } from '../lib/qualitySearch';
import { createPdf } from '../lib/pdfWriter';
import { unsharpMask } from '../lib/sharpen';
import type { CropRect, OutputFormat } from '../lib/types';
import { encodeRaw, optimisePng } from './codecs';
import type { ComposeJob, ComposeResult, EncodeJob, EncodeResult, FillJob, FillResult } from './protocol';

/** EncodeResult.warning when the target size can't be reached. */
export const TARGET_MISSED = 'target-missed';

export type CanvasEnv = {
  create: (width: number, height: number) => Surface;
  toBlob: (canvas: Surface, type: string, quality?: number) => Promise<Blob>;
  toBitmap: (canvas: Surface) => Promise<ImageBitmap>;
};

export const offscreenEnv: CanvasEnv = {
  create: (width, height) => new OffscreenCanvas(width, height),
  toBlob: (canvas, type, quality) => (canvas as OffscreenCanvas).convertToBlob({ type, quality }),
  toBitmap: async (canvas) => (canvas as OffscreenCanvas).transferToImageBitmap(),
};

export const domEnv: CanvasEnv = {
  create: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  toBlob: (canvas, type, quality) =>
    new Promise((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed.'))), type, quality);
    }),
  toBitmap: (canvas) => createImageBitmap(canvas),
};

/** Called between expensive steps; throws to abort a superseded job. */
export type Checkpoint = () => Promise<void>;

type DrawSource = CanvasImageSource & { width: number; height: number };

const releaseCanvas = (canvas: Surface): void => {
  canvas.width = 0;
  canvas.height = 0;
};

const applyTransform = (env: CanvasEnv, job: EncodeJob): DrawSource => {
  if (isIdentityTransform(job.transform)) return job.bitmap;
  const size = transformedSize(job.bitmap, job.transform.rotation);
  const canvas = env.create(size.width, size.height);
  drawTransformed(get2d(canvas), job.bitmap, job.transform);
  return canvas;
};

/**
 * Resamples `rect` of `source` to exactly targetWidth×targetHeight. While the current size
 * is at least 2× the target it halves with high-quality smoothing first, which avoids the
 * aliasing a single large downscale produces.
 */
const resample = async (
  env: CanvasEnv,
  source: DrawSource,
  rect: CropRect,
  targetWidth: number,
  targetHeight: number,
  checkpoint: Checkpoint,
): Promise<Surface> => {
  let current: DrawSource = source;
  let region = { ...rect };

  while (region.width / 2 >= targetWidth && region.height / 2 >= targetHeight) {
    const width = Math.round(region.width / 2);
    const height = Math.round(region.height / 2);
    const step = env.create(width, height);
    const context = get2d(step);
    context.imageSmoothingQuality = 'high';
    context.drawImage(current, region.x, region.y, region.width, region.height, 0, 0, width, height);
    if (current !== source) releaseCanvas(current as Surface);
    current = step;
    region = { x: 0, y: 0, width, height };
    await checkpoint();
  }

  const result = env.create(targetWidth, targetHeight);
  const context = get2d(result);
  context.imageSmoothingQuality = 'high';
  context.drawImage(current, region.x, region.y, region.width, region.height, 0, 0, targetWidth, targetHeight);
  if (current !== source) releaseCanvas(current as Surface);
  return result;
};

/** `image`: for PDF output, the JPEG placed on the page. */
type Encoded = { blob: Blob; encoder: 'wasm' | 'native'; image?: Blob };

type LossyFormat = Exclude<OutputFormat, 'png' | 'pdf'>;

const nativeEncode = async (env: CanvasEnv, canvas: Surface, format: LossyFormat, quality: number): Promise<Blob> => {
  const mime = FORMAT_MIME[format];
  const blob = await env.toBlob(canvas, mime, quality / 100);
  // Browsers silently fall back to PNG for types they can't encode (e.g. AVIF).
  if (blob.type !== mime) throw new Error(`This browser can't encode ${FORMAT_LABELS[format]} and the ${FORMAT_LABELS[format]} encoder failed to load.`);
  return blob;
};

const encodePng = async (env: CanvasEnv, canvas: Surface): Promise<Encoded> => {
  const png = await env.toBlob(canvas, 'image/png');
  try {
    const optimised = await optimisePng(await png.arrayBuffer());
    return { blob: new Blob([optimised], { type: 'image/png' }), encoder: 'wasm' };
  } catch {
    return { blob: png, encoder: 'native' };
  }
};

/** Encodes at one quality, falling back to the browser encoder if the wasm codec fails to load. */
const createLossyEncoder = (env: CanvasEnv, canvas: Surface, format: LossyFormat) => {
  let pixels: ImageData | null = null;
  let useNative = false;
  return async (quality: number): Promise<Encoded> => {
    if (!useNative) {
      try {
        pixels ??= get2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
        const buffer = await encodeRaw(format, pixels, quality);
        return { blob: new Blob([buffer], { type: FORMAT_MIME[format] }), encoder: 'wasm' };
      } catch (error) {
        console.warn(`${FORMAT_LABELS[format]} wasm encoder failed; using the browser encoder.`, error);
        useNative = true;
      }
    }
    return { blob: await nativeEncode(env, canvas, format, quality), encoder: 'native' };
  };
};

/** Wraps each JPEG in a one-page PDF sized to the image at `dpi`. */
const wrapInPdf =
  (encodeJpeg: (quality: number) => Promise<Encoded>, dpi: number) =>
  async (quality: number): Promise<Encoded> => {
    const jpeg = await encodeJpeg(quality);
    const pdf = createPdf([{ jpeg: new Uint8Array(await jpeg.blob.arrayBuffer()), dpi }]);
    return { blob: new Blob([pdf], { type: 'application/pdf' }), encoder: jpeg.encoder, image: jpeg.blob };
  };

/**
 * Resolution of a PDF output page. A source with a known resolution (a PDF page) keeps its
 * physical size through crops and resizes; anything else is placed at 96 dpi.
 */
export const outputDpi = (sourceDpi: number | null, sourceWidth: number, drawWidth: number): number =>
  sourceDpi ? (sourceDpi * drawWidth) / sourceWidth : 96;

export const runEncodeJob = async (job: EncodeJob, env: CanvasEnv, checkpoint: Checkpoint): Promise<EncodeResult> => {
  const { settings } = job;
  const transformed = applyTransform(env, job);
  const geometry = resolveOutputGeometry(transformed, job.crop, settings);
  await checkpoint();

  const resized = await resample(env, transformed, geometry.sourceRect, geometry.drawRect.width, geometry.drawRect.height, checkpoint);
  if (transformed !== job.bitmap) releaseCanvas(transformed as Surface);

  const output = env.create(geometry.outWidth, geometry.outHeight);
  const context = get2d(output, { willReadFrequently: true });
  const padded =
    geometry.drawRect.width !== geometry.outWidth || geometry.drawRect.height !== geometry.outHeight;

  if (settings.format === 'jpeg' || settings.format === 'pdf' || padded) {
    // Padding for contain mode; for JPEG this also composites any transparency over the matte.
    const needsMatte = padded || hasTransparency(get2d(resized).getImageData(0, 0, resized.width, resized.height).data);
    if (needsMatte) {
      context.fillStyle = settings.matteColor;
      context.fillRect(0, 0, geometry.outWidth, geometry.outHeight);
    }
  }
  context.drawImage(resized, geometry.drawRect.x, geometry.drawRect.y);
  releaseCanvas(resized);

  const downscaled = geometry.sourceRect.width > geometry.drawRect.width;
  if (settings.sharpen > 0 && downscaled) {
    const pixels = context.getImageData(0, 0, geometry.outWidth, geometry.outHeight);
    unsharpMask(pixels.data, pixels.width, pixels.height, settings.sharpen);
    context.putImageData(pixels, 0, 0);
  }

  const reference = job.wantReference ? await createImageBitmap(output) : null;
  const dpi = outputDpi(job.sourceDpi, geometry.sourceRect.width, geometry.drawRect.width);
  await checkpoint();

  let encoded: Encoded;
  let quality = settings.quality;
  let warning: string | null = null;

  if (settings.format === 'png') {
    encoded = await encodePng(env, output);
    quality = 100;
  } else {
    const lossy = createLossyEncoder(env, output, settings.format === 'pdf' ? 'jpeg' : settings.format);
    const encodeAt = settings.format === 'pdf' ? wrapInPdf(lossy, dpi) : lossy;
    if (settings.targetMaxBytes) {
      const attempts = new Map<number, Encoded>();
      const search = await findQualityForTarget(async (candidate) => {
        await checkpoint();
        const attempt = await encodeAt(candidate);
        attempts.set(candidate, attempt);
        return attempt.blob.size;
      }, settings.targetMaxBytes);
      quality = search.quality;
      encoded = attempts.get(search.quality) as Encoded;
      if (!search.reachable) {
        // A code, not text: the UI shows it in the user's language.
        warning = TARGET_MISSED;
      }
    } else {
      encoded = await encodeAt(settings.quality);
    }
  }

  releaseCanvas(output);

  return {
    blob: encoded.blob,
    width: geometry.outWidth,
    height: geometry.outHeight,
    quality,
    encoder: encoded.encoder,
    warning,
    upscaleCapped: geometry.upscaleCapped,
    reference,
    pdfImage: encoded.image ?? null,
    dpi,
  };
};

/** Object removal: fills the masked pixels and returns the edited image. */
export const runFillJob = async (job: FillJob, env: CanvasEnv): Promise<FillResult> => {
  const region = job.region ?? { x: 0, y: 0, width: job.bitmap.width, height: job.bitmap.height };
  const { width, height } = region;
  if (job.mask.length !== width * height) throw new Error('The mask does not match the image size.');
  const canvas = env.create(job.bitmap.width, job.bitmap.height);
  const context = get2d(canvas, { willReadFrequently: true });
  context.drawImage(job.bitmap, 0, 0);
  // Only the stroke's neighbourhood is read and written: a stroke on a 12 MP photo stays fast.
  const pixels = context.getImageData(region.x, region.y, width, height);

  let color: [number, number, number] | null = null;
  if (job.method === 'flat') {
    color = job.color ?? ringMedianColor(pixels.data, width, height, job.mask);
    if (!color) throw new Error('Nothing to fill: paint over the object first.');
    flatFill(pixels.data, job.mask, color);
  } else if (!harmonicFill(pixels.data, width, height, job.mask)) {
    throw new Error('Nothing to fill: paint over the object first, leaving some background around it.');
  }

  context.putImageData(pixels, region.x, region.y);
  const bitmap = await env.toBitmap(canvas);
  return { bitmap, color };
};

/** Background removal: replaces the alpha channel, optionally flattening onto a color. */
export const runComposeJob = async (job: ComposeJob, env: CanvasEnv): Promise<ComposeResult> => {
  const { width, height } = job.bitmap;
  if (job.alpha.length !== width * height) throw new Error('The mask does not match the image size.');
  const canvas = env.create(width, height);
  const context = get2d(canvas, { willReadFrequently: true });
  context.drawImage(job.bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < job.alpha.length; index += 1) pixels.data[index * 4 + 3] = job.alpha[index] as number;
  context.putImageData(pixels, 0, 0);

  if (job.background) {
    const flattened = env.create(width, height);
    const flatContext = get2d(flattened);
    flatContext.fillStyle = job.background;
    flatContext.fillRect(0, 0, width, height);
    flatContext.drawImage(canvas, 0, 0);
    releaseCanvas(canvas);
    return { bitmap: await env.toBitmap(flattened) };
  }
  return { bitmap: await env.toBitmap(canvas) };
};
