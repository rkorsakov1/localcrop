// Getting images into the app: decoding, folder traversal, URL fetch.

import { decodeRaw, sniffFormat, svgIntrinsicSize, svgRasterSize, type SniffedKind } from '../lib/decoders';
import type { RawImage } from '../lib/decoders/types';
import { isZip, unzip } from '../lib/unzip';
import { decodeHeif } from '../worker/heifClient';
import { isPdf, renderPdf } from './pdf';

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'png', 'apng', 'webp', 'avif', 'gif', 'bmp', 'dib', 'ico', 'cur', 'svg',
  'tif', 'tiff', 'tga', 'pbm', 'pgm', 'ppm', 'pnm', 'pam', 'qoi', 'heic', 'heif', 'jxl', 'pdf',
]);

/** For <input type=file accept>: image/* alone hides .tga, .qoi, .pnm and (on some systems) .heic. ZIPs are unpacked, PDF pages rendered. */
export const FILE_INPUT_ACCEPT = ['image/*', 'application/pdf', ...[...IMAGE_EXTENSIONS].map((extension) => `.${extension}`), '.zip', 'application/zip'].join(',');

const isZipName = (name: string, type = ''): boolean => extensionOf(name) === 'zip' || type === 'application/zip' || type === 'application/x-zip-compressed';

type Incoming = File | { blob: Blob; name: string };

/**
 * Replaces ZIP files with the images inside them (natural path order, nested ZIPs one level deep).
 * Anything that isn't an image is left out quietly.
 */
export const expandArchives = async (files: readonly Incoming[], depth = 0): Promise<{ files: Incoming[]; failures: DecodeFailure[] }> => {
  const out: Incoming[] = [];
  const failures: DecodeFailure[] = [];
  for (const file of files) {
    const blob = file instanceof File ? file : file.blob;
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (!isZipName(file.name, blob.type) || !isZip(head)) {
      out.push(file);
      continue;
    }
    try {
      const entries = await unzip(await blob.arrayBuffer(), (path) => IMAGE_EXTENSIONS.has(extensionOf(path)) || (depth === 0 && isZipName(path)));
      entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      const inner = entries.map((entry) => ({ blob: new Blob([entry.data as BlobPart]), name: entry.path.split('/').pop() ?? entry.path }));
      const nested = await expandArchives(inner, depth + 1);
      out.push(...nested.files);
      failures.push(...nested.failures);
      if (entries.length === 0) failures.push({ name: file.name, message: 'No images found in this ZIP.' });
    } catch (error) {
      failures.push({ name: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { files: out, failures };
};

/** Shown in the empty state. */
export const SUPPORTED_FORMAT_LABELS = ['JPEG', 'PNG', 'WebP', 'AVIF', 'HEIC', 'PDF', 'GIF', 'TIFF', 'BMP', 'SVG', 'ICO', 'TGA', 'QOI', 'PNM'];
export const LARGE_IMAGE_PIXELS = 50_000_000;

/** `dpi`: known source resolution (PDF pages are rendered at a chosen dpi). */
export type Decoded = { bitmap: ImageBitmap; name: string; bytes: number; type: string; dpi?: number };
export type DecodeFailure = { name: string; message: string };

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return '';
  return name.slice(dot + 1).toLowerCase();
};

/** Quick filter for folder contents: skips obvious non-images like .DS_Store or .txt. */
export const looksLikeImageFile = (file: File): boolean =>
  file.type.startsWith('image/') || file.type === 'application/pdf' || IMAGE_EXTENSIONS.has(extensionOf(file.name)) || isZipName(file.name, file.type);

const unsupportedMessage = (name: string, kind: SniffedKind): string => {
  if (kind === 'jxl') return 'JPEG XL can only be opened in Safari. Convert it to JPEG or PNG first, or use Safari.';
  const extension = extensionOf(name);
  if (['psd', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'eps', 'ai'].includes(extension)) {
    return `${extension.toUpperCase()} files aren’t supported. Export a JPEG, PNG or TIFF first.`;
  }
  return `Unsupported format. Supported: ${SUPPORTED_FORMAT_LABELS.join(', ')}.`;
};

const fromRaw = (raw: RawImage): Promise<ImageBitmap> =>
  createImageBitmap(new ImageData(raw.data as Uint8ClampedArray<ArrayBuffer>, raw.width, raw.height));

/** Draws the SVG at a generous size: vectors have no fixed resolution, and the upscale guard would otherwise cap the output. */
const rasterizeSvg = async (blob: Blob): Promise<ImageBitmap> => {
  const text = await blob.text();
  const intrinsic = svgIntrinsicSize(text) ?? { width: 1024, height: 1024 };
  const size = svgRasterSize(intrinsic);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available.');
    context.drawImage(image, 0, 0, size.width, size.height);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Decodes with EXIF orientation applied. The browser handles what it can (GIFs give their first
 * frame); SVG, TIFF, TGA, PNM, QOI and HEIC (outside Safari) go through our own decoders.
 */
export const decodeImage = async (blob: Blob, name: string): Promise<Decoded> => {
  const head = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
  const kind = sniffFormat(head, name, blob.type);
  const done = (bitmap: ImageBitmap): Decoded => ({ bitmap, name, bytes: blob.size, type: blob.type });

  if (kind === 'svg') {
    try {
      return done(await rasterizeSvg(blob));
    } catch {
      throw new Error('This SVG couldn’t be drawn. It may reference external files or be malformed.');
    }
  }

  try {
    return done(await createImageBitmap(blob, { imageOrientation: 'from-image' }));
  } catch {
    // Not decodable natively; try our own decoders below.
  }

  if (kind === 'heif') {
    try {
      return done(await fromRaw(await decodeHeif(await blob.arrayBuffer())));
    } catch (error) {
      throw new Error(`Couldn’t decode this HEIC image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const raw = await decodeRaw(kind, await blob.arrayBuffer()).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });
  if (raw) return done(await fromRaw(raw));
  throw new Error(unsupportedMessage(name, kind));
};

/** A PDF's rendered pages, and how many pages it has in total (only the first MAX_PDF_PAGES are rendered). */
export type DecodedFile = { images: Decoded[]; pdfPages?: number };

/** Like decodeImage, but a PDF gives one image per page. */
export const decodeFile = async (blob: Blob, name: string): Promise<DecodedFile> => {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (!isPdf(head)) return { images: [await decodeImage(blob, name)] };
  const { pages, total } = await renderPdf(blob, name);
  // The file's size is shared out between its pages, so savings stay honest in total.
  const bytes = Math.round(blob.size / Math.max(1, pages.length));
  return { images: pages.map((page) => ({ bitmap: page.bitmap, name: page.name, bytes, type: 'application/pdf', dpi: page.dpi })), pdfPages: total };
};

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const entryToFile = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

const walkEntry = async (entry: FileSystemEntry): Promise<File[]> => {
  if (entry.isFile) {
    const file = await entryToFile(entry as FileSystemFileEntry);
    return looksLikeImageFile(file) ? [file] : [];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  // readEntries returns results in batches; keep reading until it returns none.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) break;
    for (const child of batch) files.push(...(await walkEntry(child)));
  }
  return files;
};

/** Natural order by folder path then name, so "Frame 2" comes before "Frame 10". */
export const compareFilePaths = (a: File, b: File): number =>
  (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true });

/** Files from a drop, recursing into dropped folders. Sorted by path within each folder. */
export const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
  const items = Array.from(dataTransfer.items).filter((item) => item.kind === 'file');
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.every((entry) => entry === null)) return Array.from(dataTransfer.files);

  const files: File[] = [];
  for (const [index, entry] of entries.entries()) {
    if (entry) {
      const found = await walkEntry(entry);
      if (entry.isDirectory) found.sort(compareFilePaths);
      files.push(...found);
      continue;
    }
    const file = items[index]?.getAsFile();
    if (file) files.push(file);
  }
  return files;
};

export const looksLikeUrl = (text: string): boolean => {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed) || /\s/.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
};

export const CORS_FAILURE_MESSAGE =
  "This site doesn't allow direct loading. Right-click the image → Copy image, then paste here.";

const nameFromUrl = (url: URL, type: string): string => {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const extension = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'img';
  return `${last || url.hostname}.${extension}`;
};

/** Best-effort fetch. Most sites block cross-origin reads; the caller shows CORS_FAILURE_MESSAGE. */
export const fetchImageFromUrl = async (input: string): Promise<{ blob: Blob; name: string }> => {
  const url = new URL(input.trim());
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error(CORS_FAILURE_MESSAGE);
  }
  if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}.`.trim());
  const blob = await response.blob();
  if (blob.type.startsWith('text/html')) throw new Error('That URL returned a web page, not an image. Open the image itself and copy its address.');
  return { blob, name: nameFromUrl(url, blob.type) };
};
