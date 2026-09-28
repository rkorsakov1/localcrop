import { describe, expect, it } from 'vitest';
import { DEFAULT_FILENAME_TEMPLATE, dedupeFilenames, renderFilename } from './filenameTemplate';

const context = {
  sourceName: 'Screenshot 2024-05-01 at 10.00.00.PNG',
  width: 1280,
  height: 720,
  presetName: 'YouTube thumbnail',
  index: 3,
  queueLength: 120,
  format: 'jpeg' as const,
};

describe('renderFilename', () => {
  it('renders the default template', () => {
    expect(renderFilename(DEFAULT_FILENAME_TEMPLATE, context)).toBe('Screenshot-2024-05-01-at-10-00-00-1280x720.jpg');
  });

  it('pads the index to the queue length', () => {
    expect(renderFilename('{i}-{preset}.{ext}', context)).toBe('003-YouTube-thumbnail.jpg');
  });

  it('keeps unknown tokens literally', () => {
    expect(renderFilename('{name}-{foo}.{ext}', { ...context, sourceName: 'a.png', format: 'webp' })).toBe('a-{foo}.webp');
  });

  it('replaces path separators', () => {
    expect(renderFilename('out/{name}.{ext}', { ...context, sourceName: 'a.png' })).toBe('out-a.jpg');
  });

  it('falls back when the template renders empty', () => {
    expect(renderFilename('   ', context)).toBe('image.jpg');
  });
});

describe('dedupeFilenames', () => {
  it('suffixes duplicates before the extension', () => {
    expect(dedupeFilenames(['a.jpg', 'a.jpg', 'A.jpg', 'a-2.jpg', 'b'])).toEqual(['a.jpg', 'a-2.jpg', 'A-3.jpg', 'a-2-2.jpg', 'b']);
  });
});
