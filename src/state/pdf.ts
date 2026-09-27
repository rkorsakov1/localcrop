// PDF input: each page is rendered to an image with the vendored pdf.js (public/vendor/pdfjs@…),
// which is only downloaded when the first PDF arrives.

export const PDFJS_DIR = 'vendor/pdfjs@6.3.289/';

/** Pages beyond this are skipped (with a notice): every page becomes a full-size bitmap in memory. */
export const MAX_PDF_PAGES = 50;
/** Longest side of a rendered page, in pixels. */
const MAX_PAGE_SIDE = 6000;

type Viewport = { width: number; height: number };
type PdfPage = {
  getViewport: (options: { scale: number }) => Viewport;
  render: (options: { canvas: HTMLCanvasElement; viewport: Viewport; background?: string }) => { promise: Promise<void> };
  cleanup: () => void;
};
type PdfDocument = { numPages: number; getPage: (number: number) => Promise<PdfPage> };
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: Record<string, unknown>) => { promise: Promise<PdfDocument>; destroy: () => Promise<void> };
};

const assetUrl = (path: string): string => new URL(`${PDFJS_DIR}${path}`, new URL(import.meta.env.BASE_URL, window.location.origin)).href;

let pdfjs: Promise<PdfJs> | null = null;

const loadPdfJs = (): Promise<PdfJs> => {
  pdfjs ??= (import(/* @vite-ignore */ assetUrl('pdf.min.mjs')) as Promise<PdfJs>).then((module) => {
    module.GlobalWorkerOptions.workerSrc = assetUrl('pdf.worker.min.mjs');
    return module;
  });
  // A failed download (e.g. offline before it was ever cached) can be retried with the next PDF.
  pdfjs.catch(() => {
    pdfjs = null;
  });
  return pdfjs;
};

/** True for the "%PDF-" signature. */
export const isPdf = (head: Uint8Array): boolean =>
  head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;

/** Resolution for a document with `pages` pages: sharp for a few pages, lighter for long documents. */
export const pdfDpi = (pages: number): number => (pages <= 10 ? 200 : pages <= 30 ? 150 : 100);

export type PdfPageImage = { bitmap: ImageBitmap; name: string; dpi: number };

/** "report.pdf" page 3 of 12 → "report-p03.pdf"; a single page keeps the file's name. */
export const pdfPageName = (name: string, page: number, pages: number): string => {
  if (pages === 1) return name;
  const base = name.replace(/\.pdf$/i, '');
  return `${base}-p${String(page).padStart(String(pages).length, '0')}.pdf`;
};

/** Renders the pages of a PDF to bitmaps (white background), at most MAX_PDF_PAGES of them. */
export const renderPdf = async (blob: Blob, name: string): Promise<{ pages: PdfPageImage[]; total: number }> => {
  const lib = await loadPdfJs().catch(() => {
    throw new Error('The PDF viewer could not be loaded.');
  });
  const task = lib.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    isEvalSupported: false,
    enableXfa: false,
  });
  let pdf: PdfDocument;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password first.');
    throw new Error(`Couldn’t read this PDF: ${error instanceof Error ? error.message : String(error)}`);
  }

  const total = pdf.numPages;
  const count = Math.min(total, MAX_PDF_PAGES);
  const scale = pdfDpi(count) / 72;
  const pages: PdfPageImage[] = [];
  try {
    for (let number = 1; number <= count; number += 1) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const pageScale = Math.min(scale, MAX_PAGE_SIDE / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale: pageScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      pages.push({ bitmap: await createImageBitmap(canvas), name: pdfPageName(name, number, count), dpi: (canvas.width / natural.width) * 72 });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } catch (error) {
    for (const page of pages) page.bitmap.close();
    throw new Error(`Couldn’t render this PDF: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Destroying the loading task also destroys the document and frees the worker's copy.
    await task.destroy().catch(() => undefined);
  }
  return { pages, total };
};
