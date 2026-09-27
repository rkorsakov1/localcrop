/** 'pdf' is a JPEG on a PDF page sized to the image. */
export type OutputFormat = 'jpeg' | 'webp' | 'avif' | 'png' | 'pdf';
/** cover = crop to the exact size; contain = fit and pad; free = any crop shape, scaled to fit within width × height. */
export type FitMode = 'cover' | 'contain' | 'free';

export type Preset = {
  id: string;
  name: string;
  /** null = derive from height + source aspect */
  width: number | null;
  /** null = derive from width + source aspect; both null = original size */
  height: number | null;
  /** cover = crop to fill; contain = fit whole image and pad; free = unlocked crop that fits within the size */
  fit: FitMode;
  format: OutputFormat;
  /** 0–100; ignored for png */
  quality: number;
  /** if set, search for the highest quality whose output is <= this many bytes */
  targetMaxBytes: number | null;
  /** hex; used for contain padding and alpha→JPEG */
  matteColor: string;
  allowUpscale: boolean;
  filenameTemplate: string;
  /** unsharp-mask amount after downscaling, 0–100; 0 = off */
  sharpen: number;
};

export type PresetFile = { app: 'localcrop'; schemaVersion: 1; presets: Preset[] };

/** In source pixels of the transformed (rotated/flipped) image. */
export type CropRect = { x: number; y: number; width: number; height: number };

export type Rotation = 0 | 90 | 180 | 270;
export type Transform = { rotation: Rotation; flipH: boolean; flipV: boolean };

/** The subset of a preset that affects encoding. */
export type EncodeSettings = Pick<
  Preset,
  'width' | 'height' | 'fit' | 'format' | 'quality' | 'targetMaxBytes' | 'matteColor' | 'allowUpscale' | 'sharpen'
>;

export type EncodedOutput = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  quality: number;
  encoder: 'wasm' | 'native';
  warning: string | null;
  /** An image URL for previews: `url` itself, or for a PDF the JPEG on its page. */
  previewUrl: string;
  /** PDF output: the JPEG on its page, so several outputs can be combined into one PDF. */
  pdfImage: Blob | null;
  /** Resolution for placing the output on a PDF page (the source's, carried through crop and resize; else 96). */
  dpi: number;
};

/** A background cut-out that can still be refined. All bitmaps are immutable snapshots, so undo can swap them. */
export type Cutout = {
  /** The image before removal. */
  base: ImageBitmap;
  /** Alpha mask at base resolution (white, alpha = coverage). */
  mask: ImageBitmap;
  /** Fill color behind the subject, or null for transparency. */
  background: string | null;
  provider: 'webgpu' | 'wasm';
};

export type QueueStatus = 'idle' | 'encoding' | 'ready' | 'error';

export type QueueItem = {
  id: string;
  sourceName: string;
  sourceBytes: number;
  sourceType: string;
  /** Pixels per inch of the source when known (PDF pages), for sizing PDF output pages; null = 96. */
  sourceDpi: number | null;
  /** decoded, EXIF orientation applied */
  sourceBitmap: ImageBitmap;
  /** after retouch / bg removal; null = none */
  editedBitmap: ImageBitmap | null;
  /** Background removal in progress: editedBitmap is `base` composed with `mask`. */
  cutout: Cutout | null;
  transform: Transform;
  /** null = auto (recomputed from preset) */
  crop: CropRect | null;
  presetId: string;
  /** per-image tweaks without editing the preset */
  overrides: Partial<Preset>;
  status: QueueStatus;
  output: EncodedOutput | null;
  error: string | null;
  /** bumped whenever something that affects the output changes */
  revision: number;
  /** revision the current output was produced from */
  outputRevision: number;
};
