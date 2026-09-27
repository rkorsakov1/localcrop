import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../lib/cropMath';
import { BUILTIN_PRESETS } from '../lib/presets';
import type { Preset, QueueItem } from '../lib/types';
import { cropAfterSettingsChange } from './appReducer';

const youtube = BUILTIN_PRESETS[0] as Preset; // 1280 × 720, cover
const item = (crop: QueueItem['crop']): QueueItem =>
  ({ sourceBitmap: { width: 2000, height: 1500 }, editedBitmap: null, transform: IDENTITY_TRANSFORM, crop }) as unknown as QueueItem;

describe('cropAfterSettingsChange', () => {
  it('keeps the automatic 16:9 selection when W × H is unlinked', () => {
    const crop = cropAfterSettingsChange(item(null), youtube, { ...youtube, fit: 'free' });
    expect(crop).toEqual({ x: 0, y: 187.5, width: 2000, height: 1125 });
  });

  it('keeps a manual crop when unlinking', () => {
    const manual = { x: 100, y: 100, width: 800, height: 450 };
    expect(cropAfterSettingsChange(item(manual), youtube, { ...youtube, fit: 'free' })).toBe(manual);
  });

  it('reshapes a manual crop around its center when the ratio changes', () => {
    const manual = { x: 100, y: 100, width: 800, height: 450 };
    const crop = cropAfterSettingsChange(item(manual), youtube, { ...youtube, height: 800 }) as NonNullable<QueueItem['crop']>;
    expect(crop.width / crop.height).toBeCloseTo(1.6);
    expect(crop.x + crop.width / 2).toBeCloseTo(500);
    expect(crop.y + crop.height / 2).toBeCloseTo(325);
  });

  it('leaves an automatic crop automatic when the ratio changes', () => {
    expect(cropAfterSettingsChange(item(null), youtube, { ...youtube, height: 800 })).toBeNull();
  });

  it('ignores changes that do not affect the crop', () => {
    const manual = { x: 1, y: 2, width: 300, height: 200 };
    expect(cropAfterSettingsChange(item(manual), youtube, { ...youtube, quality: 50 })).toBe(manual);
  });
});
