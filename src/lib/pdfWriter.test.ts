import { describe, expect, it } from 'vitest';
import { createPdf, readJpegInfo } from './pdfWriter';

/** The smallest useful stand-in for a JPEG: SOI, an APP0 segment, SOF0 with size and components, EOI. */
const fakeJpeg = (width: number, height: number, components = 3): Uint8Array =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, components, 0, 0, 0,
    0xff, 0xd9,
  ]);

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('readJpegInfo', () => {
  it('reads size and components from the frame header', () => {
    expect(readJpegInfo(fakeJpeg(1280, 720))).toEqual({ width: 1280, height: 720, components: 3 });
    expect(readJpegInfo(fakeJpeg(3, 5, 1))).toEqual({ width: 3, height: 5, components: 1 });
  });

  it('rejects data that is not a JPEG', () => {
    expect(() => readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow('Not a JPEG image.');
  });
});

describe('createPdf', () => {
  it('sizes each page from the image and its dpi', () => {
    const pdf = text(createPdf([{ jpeg: fakeJpeg(960, 540), dpi: 96 }, { jpeg: fakeJpeg(1654, 2339), dpi: 200 }]));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/MediaBox [0 0 720 405]');
    // 1654 × 2339 px at 200 dpi is A4.
    expect(pdf).toContain('/MediaBox [0 0 595.44 842.04]');
    expect(pdf).toContain('/Width 1654 /Height 2339 /ColorSpace /DeviceRGB');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('writes an xref table whose offsets point at the objects', () => {
    const pdf = text(createPdf([{ jpeg: fakeJpeg(10, 10), dpi: 72 }]));
    const start = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
    const entries = [...pdf.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((match) => Number(match[1]));
    expect(entries).toHaveLength(6);
    entries.forEach((offset, index) => expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
  });

  it('embeds the JPEG bytes unchanged, with the right length', () => {
    const jpeg = fakeJpeg(4, 4);
    const pdf = createPdf([{ jpeg, dpi: 72 }]);
    const body = text(pdf);
    const at = body.indexOf('stream\n', body.indexOf('/DCTDecode')) + 'stream\n'.length;
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg]);
    expect(body).toContain(`/Length ${jpeg.length} >>`);
  });
});
