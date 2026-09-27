// Drives the vendored jSquash Emscripten/wasm-bindgen glue directly (see VENDOR.md).
// Default options are copied from the upstream jSquash `meta.js` files
// (Apache-2.0, Copyright 2020 Google Inc. / Jamie Sinclair).

import type { OutputFormat } from '../lib/types';

export type RawImage = { data: Uint8ClampedArray; width: number; height: number };

type EncoderModule = {
  encode: (data: Uint8Array | Uint8ClampedArray, width: number, height: number, options: Record<string, unknown>) => Uint8Array | null;
};

const MOZJPEG_DEFAULTS = {
  quality: 75,
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3, // YCbCr
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2,
  separate_chroma_quality: false,
  chroma_quality: 75,
};

const WEBP_DEFAULTS = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
};

const AVIF_DEFAULTS = {
  quality: 50,
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  // 0 = slowest … 10 = fastest. 7 keeps a single-threaded 1280×720 encode around 1–2 s.
  speed: 7,
  subsample: 1, // 4:2:0
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
  bitDepth: 8,
  lossless: false,
};

const OXIPNG_LEVEL = 2;

// Minimal module using a v128 instruction; from wasm-feature-detect (Apache-2.0).
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

const supportsSimd = (): boolean => {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
};

const moduleCache = new Map<string, Promise<EncoderModule>>();

type WasmBinaryLoader = (vendorPath: string) => Promise<ArrayBuffer>;
let wasmBinaryLoader: WasmBinaryLoader | null = null;

/**
 * Overrides how .wasm files are fetched (paths relative to src/vendor/jsquash/).
 * Only used by tests running in Node, where the glue can't fetch bundler asset URLs.
 */
export const setWasmBinaryLoader = (loader: WasmBinaryLoader | null): void => {
  wasmBinaryLoader = loader;
  moduleCache.clear();
};

type EmscriptenGlue = { default: (options?: Record<string, unknown>) => Promise<EncoderModule> };

const loadEmscripten = (key: string, wasmPath: string, load: () => Promise<EmscriptenGlue>) => {
  const cached = moduleCache.get(key);
  if (cached) return cached;
  const promise = load().then(async (glue) => {
    const wasmBinary = wasmBinaryLoader ? await wasmBinaryLoader(wasmPath) : undefined;
    return glue.default({ noInitialRun: true, ...(wasmBinary ? { wasmBinary } : {}) });
  });
  // Drop failed loads so a later call can retry.
  promise.catch(() => moduleCache.delete(key));
  moduleCache.set(key, promise);
  return promise;
};

const loadJpeg = () => loadEmscripten('jpeg', 'jpeg@1.6.0/mozjpeg_enc.wasm', () => import('../vendor/jsquash/jpeg@1.6.0/mozjpeg_enc.js'));

const loadWebp = () =>
  supportsSimd()
    ? loadEmscripten('webp-simd', 'webp@1.5.0/webp_enc_simd.wasm', () => import('../vendor/jsquash/webp@1.5.0/webp_enc_simd.js'))
    : loadEmscripten('webp', 'webp@1.5.0/webp_enc.wasm', () => import('../vendor/jsquash/webp@1.5.0/webp_enc.js'));

const loadAvif = () => loadEmscripten('avif', 'avif@2.1.1/avif_enc.wasm', () => import('../vendor/jsquash/avif@2.1.1/avif_enc.js'));

type Oxipng = { optimise: (data: Uint8Array, level: number, interlace: boolean, optimizeAlpha: boolean) => Uint8Array };
let oxipngPromise: Promise<Oxipng> | null = null;

const loadOxipng = (): Promise<Oxipng> => {
  if (oxipngPromise) return oxipngPromise;
  oxipngPromise = import('../vendor/jsquash/oxipng@2.3.0/squoosh_oxipng.js').then(async (glue) => {
    const wasmBinary = wasmBinaryLoader ? await wasmBinaryLoader('oxipng@2.3.0/squoosh_oxipng_bg.wasm') : undefined;
    await glue.default(wasmBinary);
    return { optimise: glue.optimise };
  });
  oxipngPromise.catch(() => {
    oxipngPromise = null;
  });
  return oxipngPromise;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  // Copy out of wasm memory: the view is invalidated by the next call into the module.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const encodeWith = async (load: () => Promise<EncoderModule>, image: RawImage, options: Record<string, unknown>): Promise<ArrayBuffer> => {
  const module = await load();
  const result = module.encode(image.data, image.width, image.height, options);
  if (!result) throw new Error('Encoder returned no data.');
  return toArrayBuffer(result);
};

/** Encodes RGBA pixels. `quality` is 0–100. PNG isn't handled here (see optimisePng). */
export const encodeRaw = (format: Exclude<OutputFormat, 'png' | 'pdf'>, image: RawImage, quality: number): Promise<ArrayBuffer> => {
  if (format === 'jpeg') return encodeWith(loadJpeg, image, { ...MOZJPEG_DEFAULTS, quality, chroma_quality: quality });
  if (format === 'webp') return encodeWith(loadWebp, image, { ...WEBP_DEFAULTS, quality });
  return encodeWith(loadAvif, image, { ...AVIF_DEFAULTS, quality });
};

/** Losslessly recompresses an existing PNG file. */
export const optimisePng = async (png: ArrayBuffer): Promise<ArrayBuffer> => {
  const { optimise } = await loadOxipng();
  return toArrayBuffer(optimise(new Uint8Array(png), OXIPNG_LEVEL, false, false));
};

/** Starts loading a codec ahead of time (e.g. when the user picks a format). */
export const preloadCodec = (format: OutputFormat): Promise<unknown> => {
  if (format === 'jpeg' || format === 'pdf') return loadJpeg();
  if (format === 'webp') return loadWebp();
  if (format === 'avif') return loadAvif();
  return loadOxipng();
};
