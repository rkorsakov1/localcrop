import { describe, expect, it } from 'vitest';
import {
  adaptCropToAspect,
  computeAutoCrop,
  describeRatio,
  getViewTransform,
  moveCrop,
  resizeCropFromCorner,
  resolveOutputGeometry,
  scaleCropAroundCenter,
  screenToSource,
  sourceToScreen,
  targetAspect,
  transformedSize,
  transformedToSource,
  visibleRect,
} from './cropMath';
import type { Rotation } from './types';

const cover = (width: number | null, height: number | null, allowUpscale = false) => ({
  width,
  height,
  fit: 'cover' as const,
  allowUpscale,
});

describe('computeAutoCrop', () => {
  it('centers a square crop in a wide image', () => {
    expect(computeAutoCrop({ width: 4000, height: 2000 }, 1)).toEqual({ x: 1000, y: 0, width: 2000, height: 2000 });
  });

  it('centers a wide crop in a tall image', () => {
    expect(computeAutoCrop({ width: 1000, height: 2000 }, 16 / 9)).toEqual({
      x: 0,
      y: (2000 - 562.5) / 2,
      width: 1000,
      height: 562.5,
    });
  });

  it('uses the full image for free aspect', () => {
    expect(computeAutoCrop({ width: 300, height: 200 }, null)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('targetAspect', () => {
  it('is locked only for cover with both dimensions', () => {
    expect(targetAspect(cover(1280, 720))).toBeCloseTo(16 / 9);
    expect(targetAspect(cover(1280, null))).toBeNull();
    expect(targetAspect({ width: 100, height: 100, fit: 'contain' })).toBeNull();
  });
});

describe('transformedSize', () => {
  it('swaps sides for quarter turns', () => {
    expect(transformedSize({ width: 40, height: 20 }, 90)).toEqual({ width: 20, height: 40 });
    expect(transformedSize({ width: 40, height: 20 }, 180)).toEqual({ width: 40, height: 20 });
  });
});

describe('moveCrop', () => {
  it('clamps to the image bounds', () => {
    const crop = { x: 10, y: 10, width: 50, height: 50 };
    expect(moveCrop(crop, -100, 1000, { width: 200, height: 100 })).toEqual({ x: 0, y: 50, width: 50, height: 50 });
  });
});

describe('resizeCropFromCorner', () => {
  const bounds = { width: 1000, height: 500 };

  it('keeps the aspect and anchors the opposite corner', () => {
    const crop = { x: 100, y: 100, width: 200, height: 100 };
    const result = resizeCropFromCorner(crop, 'se', { x: 500, y: 150 }, 2, bounds);
    expect(result).toEqual({ x: 100, y: 100, width: 400, height: 200 });
  });

  it('grows up-left from the nw handle', () => {
    const crop = { x: 400, y: 200, width: 200, height: 100 };
    const result = resizeCropFromCorner(crop, 'nw', { x: 300, y: 100 }, 2, bounds);
    expect(result.x + result.width).toBe(600);
    expect(result.y + result.height).toBe(300);
    expect(result.width / result.height).toBeCloseTo(2);
  });

  it('never leaves the image', () => {
    const crop = { x: 100, y: 100, width: 200, height: 100 };
    const result = resizeCropFromCorner(crop, 'se', { x: 5000, y: 5000 }, 2, bounds);
    expect(result.x + result.width).toBeLessThanOrEqual(1000);
    expect(result.y + result.height).toBeLessThanOrEqual(500);
    expect(result.width / result.height).toBeCloseTo(2);
  });

  it('enforces the 16 px minimum', () => {
    const crop = { x: 100, y: 100, width: 200, height: 200 };
    const result = resizeCropFromCorner(crop, 'se', { x: 101, y: 101 }, 1, bounds);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });

  it('resizes axes independently with free aspect', () => {
    const crop = { x: 0, y: 0, width: 100, height: 100 };
    expect(resizeCropFromCorner(crop, 'se', { x: 300, y: 50 }, null, bounds)).toEqual({ x: 0, y: 0, width: 300, height: 50 });
  });
});

describe('scaleCropAroundCenter', () => {
  it('scales around the center and stays inside', () => {
    const crop = { x: 400, y: 200, width: 100, height: 50 };
    const result = scaleCropAroundCenter(crop, 1.02, { width: 1000, height: 500 });
    expect(result.width).toBeCloseTo(102);
    expect(result.x + result.width / 2).toBeCloseTo(450);
    expect(result.y + result.height / 2).toBeCloseTo(225);
  });
});

describe('resolveOutputGeometry', () => {
  it('matches the acceptance case: 4000×2000 → 1080×1080 centered', () => {
    const geometry = resolveOutputGeometry({ width: 4000, height: 2000 }, null, cover(1080, 1080));
    expect(geometry.sourceRect).toEqual({ x: 1000, y: 0, width: 2000, height: 2000 });
    expect([geometry.outWidth, geometry.outHeight]).toEqual([1080, 1080]);
    expect(geometry.upscaleCapped).toBe(false);
  });

  it('free crop keeps its own shape and fits inside width × height', () => {
    const free = { ...cover(1280, 720), fit: 'free' as const };
    expect(targetAspect(free)).toBeNull();
    const tall = resolveOutputGeometry({ width: 4000, height: 3000 }, { x: 0, y: 0, width: 1000, height: 2000 }, free);
    expect([tall.outWidth, tall.outHeight]).toEqual([360, 720]);
    const whole = resolveOutputGeometry({ width: 4000, height: 3000 }, null, free);
    expect([whole.outWidth, whole.outHeight]).toEqual([960, 720]);
  });

  it('free crop snaps to W × H when it misses only by rounding', () => {
    const free = { ...cover(450, 250), fit: 'free' as const };
    const nearly = resolveOutputGeometry({ width: 4000, height: 3000 }, { x: 0, y: 0, width: 1253, height: 697 }, free);
    expect([nearly.outWidth, nearly.outHeight]).toEqual([450, 250]);
    const off = resolveOutputGeometry({ width: 4000, height: 3000 }, { x: 0, y: 0, width: 1250, height: 698 }, free);
    expect([off.outWidth, off.outHeight]).toEqual([448, 250]);
  });

  it('derives height from width and crop aspect', () => {
    const geometry = resolveOutputGeometry({ width: 4000, height: 3000 }, null, cover(1600, null));
    expect([geometry.outWidth, geometry.outHeight]).toEqual([1600, 1200]);
  });

  it('keeps the original size when no dimensions are set', () => {
    const geometry = resolveOutputGeometry({ width: 640, height: 480 }, null, cover(null, null));
    expect([geometry.outWidth, geometry.outHeight]).toEqual([640, 480]);
  });

  it('caps at the crop size without upscale', () => {
    const geometry = resolveOutputGeometry({ width: 800, height: 600 }, null, cover(1600, null));
    expect([geometry.outWidth, geometry.outHeight]).toEqual([800, 600]);
    expect(geometry.upscaleCapped).toBe(true);
  });

  it('never exceeds a rounded crop when capping', () => {
    // 451 px wide at 16:9 is 253.7 px tall; rounding must not produce a 452 px output.
    const geometry = resolveOutputGeometry({ width: 451, height: 300 }, null, cover(1280, 720));
    expect(geometry.outWidth).toBeLessThanOrEqual(geometry.sourceRect.width);
    expect(geometry.outHeight).toBeLessThanOrEqual(geometry.sourceRect.height);
    expect(geometry.upscaleCapped).toBe(true);
  });

  it('upscales when allowed', () => {
    const geometry = resolveOutputGeometry({ width: 800, height: 600 }, null, cover(1600, null, true));
    expect([geometry.outWidth, geometry.outHeight]).toEqual([1600, 1200]);
  });

  it('pads in contain mode', () => {
    const geometry = resolveOutputGeometry(
      { width: 4000, height: 2000 },
      null,
      { width: 1000, height: 1000, fit: 'contain', allowUpscale: false },
    );
    expect([geometry.outWidth, geometry.outHeight]).toEqual([1000, 1000]);
    expect(geometry.drawRect).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
  });
});

describe('getViewTransform', () => {
  it('fits and round-trips coordinates', () => {
    const view = getViewTransform({
      container: { width: 800, height: 600 },
      image: { width: 4000, height: 2000 },
      zoom: 'fit',
      devicePixelRatio: 2,
    });
    expect(view.scale).toBeCloseTo(0.2);
    expect(view.deviceScale).toBeCloseTo(0.4);
    expect(view.offsetY).toBeCloseTo(100);
    const point = { x: 1234, y: 567 };
    const back = screenToSource(view, sourceToScreen(view, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('shows 100% zoom as one device pixel per source pixel', () => {
    const view = getViewTransform({
      container: { width: 800, height: 600 },
      image: { width: 4000, height: 2000 },
      zoom: 1,
      devicePixelRatio: 2,
    });
    expect(view.deviceScale).toBe(1);
  });
});

describe('transformedToSource', () => {
  const source = { width: 40, height: 20 };

  it('is the identity without a transform', () => {
    expect(transformedToSource({ x: 3, y: 7 }, source, { rotation: 0, flipH: false, flipV: false })).toEqual({ x: 3, y: 7 });
  });

  it('maps displayed corners back to the right source corners', () => {
    // After a 90° clockwise turn the source's top-left corner is at the displayed top-right.
    const rotated = { rotation: 90 as Rotation, flipH: false, flipV: false };
    expect(transformedToSource({ x: 20, y: 0 }, source, rotated)).toEqual({ x: 0, y: 0 });
    expect(transformedToSource({ x: 0, y: 40 }, source, rotated)).toEqual({ x: 40, y: 20 });
  });

  it('undoes a horizontal flip', () => {
    const flipped = { rotation: 0 as Rotation, flipH: true, flipV: false };
    expect(transformedToSource({ x: 0, y: 5 }, source, flipped)).toEqual({ x: 40, y: 5 });
  });

  it('round-trips with every rotation and flip', () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const flipH of [false, true]) {
        const transform = { rotation, flipH, flipV: !flipH };
        const displayed = transformedSize(source, rotation);
        const center = transformedToSource({ x: displayed.width / 2, y: displayed.height / 2 }, source, transform);
        expect(center.x).toBeCloseTo(20);
        expect(center.y).toBeCloseTo(10);
      }
    }
  });
});

describe('adaptCropToAspect', () => {
  const bounds = { width: 4000, height: 3000 };

  it('reshapes around the same center, keeping its share of the largest box that fits', () => {
    const crop = { x: 1000, y: 1000, width: 1600, height: 900 };
    const next = adaptCropToAspect(crop, 16 / 10, bounds);
    expect(next.width / next.height).toBeCloseTo(1.6);
    expect(next.x + next.width / 2).toBeCloseTo(1800);
    expect(next.y + next.height / 2).toBeCloseTo(1450);
    expect(next.width).toBeCloseTo(1600); // 40% of the widest 16:9 and of the widest 16:10
  });

  it('keeps a full-size selection full-size through an odd in-between ratio', () => {
    const full = { x: 0, y: 375, width: 4000, height: 2250 };
    const tall = adaptCropToAspect(full, 450 / 720, bounds);
    const back = adaptCropToAspect(tall, 450 / 250, bounds);
    expect(back.width).toBeCloseTo(4000);
    expect(back.height).toBeCloseTo(4000 / 1.8);
  });

  it('shrinks to fit and stays inside the image', () => {
    const next = adaptCropToAspect({ x: 0, y: 0, width: 4000, height: 3000 }, 3, bounds);
    expect(next.width).toBeCloseTo(4000);
    expect(next.height).toBeCloseTo(4000 / 3);
    expect(next.y).toBeGreaterThanOrEqual(0);
    expect(next.y + next.height).toBeLessThanOrEqual(3000);
  });
});

describe('describeRatio', () => {
  it('names common ratios in either orientation', () => {
    expect(describeRatio(1920, 1080)).toBe('16:9');
    expect(describeRatio(1080, 1920)).toBe('9:16');
    expect(describeRatio(1920, 1200)).toBe('16:10');
    expect(describeRatio(1000, 1000)).toBe('1:1');
    expect(describeRatio(1081, 1350)).toBe('4:5');
  });

  it('falls back to a decimal ratio', () => {
    expect(describeRatio(1470, 1000)).toBe('1.47:1');
    expect(describeRatio(1000, 1470)).toBe('1:1.47');
  });
});

describe('visibleRect', () => {
  it('clips the displayed image to the container', () => {
    const view = getViewTransform({ container: { width: 800, height: 600 }, image: { width: 4000, height: 2000 }, zoom: 1, pan: { x: 0, y: 0 }, devicePixelRatio: 1 });
    expect(visibleRect(view)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    const fitted = getViewTransform({ container: { width: 800, height: 600 }, image: { width: 4000, height: 2000 }, zoom: 'fit', devicePixelRatio: 1 });
    expect(visibleRect(fitted)).toEqual({ x: 0, y: 100, width: 800, height: 400 });
  });
});
