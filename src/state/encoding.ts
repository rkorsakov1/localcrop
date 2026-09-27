import { toEncodeSettings } from '../lib/presets';
import type { EncodedOutput, Preset, QueueItem } from '../lib/types';
import type { EncodeResult } from '../worker/protocol';
import type { EncodeHandle, Processor } from '../worker/workerClient';
import { getItemPreset } from './appReducer';

/** Starts encoding one queue item with its current preset, overrides, crop and edits. */
export const encodeQueueItem = (
  processor: Processor,
  item: QueueItem,
  presets: readonly Preset[],
  wantReference: boolean,
): EncodeHandle =>
  processor.encode({
    bitmap: item.editedBitmap ?? item.sourceBitmap,
    transform: item.transform,
    crop: item.crop,
    settings: toEncodeSettings(getItemPreset({ presets: [...presets] }, item)),
    wantReference,
    sourceDpi: item.sourceDpi,
  });

/** Wraps a worker result as the item's output, with object URLs for previews (release with revokeOutput). */
export const toEncodedOutput = (result: EncodeResult): EncodedOutput => {
  const url = URL.createObjectURL(result.blob);
  return {
    blob: result.blob,
    url,
    width: result.width,
    height: result.height,
    quality: result.quality,
    encoder: result.encoder,
    warning: result.warning,
    previewUrl: result.pdfImage ? URL.createObjectURL(result.pdfImage) : url,
    pdfImage: result.pdfImage,
    dpi: result.dpi,
  };
};

/** Frees an output's object URLs once nothing shows it any more. */
export const revokeOutput = (output: EncodedOutput | null | undefined): void => {
  if (!output) return;
  URL.revokeObjectURL(output.url);
  if (output.previewUrl !== output.url) URL.revokeObjectURL(output.previewUrl);
};

/** The image to copy or share for an output: PDFs give their page image. */
export const outputImage = (output: EncodedOutput): Blob => output.pdfImage ?? output.blob;
