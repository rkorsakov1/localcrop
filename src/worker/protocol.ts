import type { CropRect, EncodeSettings, Transform } from '../lib/types';

export type EncodeJob = {
  /** Cloned (not transferred) so the main thread keeps its copy. */
  bitmap: ImageBitmap;
  transform: Transform;
  crop: CropRect | null;
  settings: EncodeSettings;
  /** Also return the source crop resampled to the output size (for Compare view). */
  wantReference: boolean;
  /** Source resolution when known (PDF pages); sets the physical page size of PDF output. */
  sourceDpi: number | null;
};

export type EncodeResult = {
  blob: Blob;
  width: number;
  height: number;
  /** Quality actually used (resolved in target-size mode); 100 for PNG. */
  quality: number;
  encoder: 'wasm' | 'native';
  warning: string | null;
  upscaleCapped: boolean;
  reference: ImageBitmap | null;
  /** PDF output: the JPEG on the page. */
  pdfImage: Blob | null;
  /** Resolution for a PDF page of this output. */
  dpi: number;
};

export type FillMethod = 'flat' | 'smooth';

export type FillJob = {
  /** The image to edit, in source orientation (before rotate/flip). */
  bitmap: ImageBitmap;
  /** One byte per pixel of `region` (or of the whole image): 0 = keep, 255 = fill, in between = soft edge. Transferred. */
  mask: Uint8Array;
  /** Only this part of the image is read, filled and written back (a stroke plus a margin). Default: everything. */
  region?: { x: number; y: number; width: number; height: number };
  method: FillMethod;
  /** Flat fill color; null = per-channel median of a 4 px ring around the mask. */
  color: [number, number, number] | null;
};

export type FillResult = { bitmap: ImageBitmap; color: [number, number, number] | null };

export type ComposeJob = {
  /** RGB source in source orientation. */
  bitmap: ImageBitmap;
  /** One byte per pixel, used as the new alpha. Transferred. */
  alpha: Uint8Array;
  /** Hex color to composite over, or null to keep transparency. */
  background: string | null;
};

export type ComposeResult = { bitmap: ImageBitmap };

export type ZipJob = { entries: { name: string; data: Uint8Array }[] };

export type ZipResult = { blob: Blob };

export type WorkerRequest =
  | { type: 'encode'; requestId: number; payload: EncodeJob }
  | { type: 'fill'; requestId: number; payload: FillJob }
  | { type: 'compose'; requestId: number; payload: ComposeJob }
  | { type: 'zip'; requestId: number; payload: ZipJob }
  | { type: 'cancel'; requestId: number };

export type WorkerResponse =
  | { type: 'encoded'; requestId: number; result: EncodeResult }
  | { type: 'filled'; requestId: number; result: FillResult }
  | { type: 'composed'; requestId: number; result: ComposeResult }
  | { type: 'zipped'; requestId: number; result: ZipResult }
  | { type: 'error'; requestId: number; message: string; cancelled: boolean };

export const CANCELLED_MESSAGE = 'Cancelled';

export const createCancelledError = (): Error => {
  const error = new Error(CANCELLED_MESSAGE);
  error.name = 'CancelledError';
  return error;
};

export const isCancelledError = (error: unknown): boolean => error instanceof Error && error.name === 'CancelledError';
