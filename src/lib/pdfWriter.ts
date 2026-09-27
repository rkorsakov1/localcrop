// A minimal PDF writer: one JPEG per page, embedded as-is (DCTDecode), so nothing is re-encoded.

export type JpegInfo = { width: number; height: number; components: number };

/** Reads size and color components from a JPEG's start-of-frame marker. */
export const readJpegInfo = (bytes: Uint8Array): JpegInfo => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG image.');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] as number;
    // Fill bytes, and markers without a length (RSTn, TEM).
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = ((bytes[offset + 5] as number) << 8) | (bytes[offset + 6] as number);
      const width = ((bytes[offset + 7] as number) << 8) | (bytes[offset + 8] as number);
      const components = bytes[offset + 9] as number;
      if (!width || !height) break;
      return { width, height, components };
    }
    offset += 2 + length;
  }
  throw new Error('The JPEG has no image size.');
};

export type PdfPage = {
  jpeg: Uint8Array;
  /** Pixels per inch: sets the page's physical size (72 pt per inch). */
  dpi: number;
};

const COLOR_SPACES: Record<number, string> = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' };

/** Up to two decimals, no exponent, no trailing zeros ("595.28", "842"). */
const num = (value: number): string => String(Math.round(value * 100) / 100);

/** Builds a PDF with one page per JPEG, each page exactly the size of its image at its dpi. */
export const createPdf = (pages: readonly PdfPage[], producer = 'LocalCrop'): Uint8Array<ArrayBuffer> => {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** Writes object `id` (1-based), recording where it begins for the xref table. */
  const object = (id: number, body: string) => {
    offsets[id] = length;
    write(`${id} 0 obj\n${body}\n`);
  };

  // Objects: 1 catalog, 2 page tree, 3 info, then page / image / content for each page.
  const pageId = (index: number) => 4 + index * 3;
  write('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj`);
  object(3, `<< /Producer (${producer}) >>\nendobj`);

  pages.forEach((page, index) => {
    const info = readJpegInfo(page.jpeg);
    const colorSpace = COLOR_SPACES[info.components];
    if (!colorSpace) throw new Error('Unsupported JPEG color format.');
    const scale = 72 / (page.dpi > 0 ? page.dpi : 96);
    const width = info.width * scale;
    const height = info.height * scale;
    const id = pageId(index);
    const content = `q ${num(width)} 0 0 ${num(height)} 0 0 cm /Im0 Do Q`;

    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>\nendobj`);
    // Adobe CMYK JPEGs store inverted values.
    const decode = info.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    // Written by hand: the stream data must follow "stream\n" directly.
    offsets[id + 1] = length;
    write(
      `${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8${decode} /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    write(page.jpeg);
    write('\nendstream\nendobj\n');
    object(id + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj`);
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  // Each xref entry is exactly 20 bytes, including the two-byte line end.
  const entries = ['0000000000 65535 f \n'];
  for (let id = 1; id < count; id += 1) entries.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`xref\n0 ${count}\n${entries.join('')}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
};
