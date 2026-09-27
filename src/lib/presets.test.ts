import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, orderedPresets } from './presets';
import type { Preset } from './types';

const user = (id: string): Preset => ({ ...(BUILTIN_PRESETS[0] as Preset), id, name: id });
const ids = (presets: Preset[]) => presets.map((preset) => preset.id);
const builtinIds = BUILTIN_PRESETS.map((preset) => preset.id);

describe('orderedPresets', () => {
  it('lists built-ins first, then yours, without a saved order', () => {
    expect(ids(orderedPresets([user('a'), user('b')], []))).toEqual([...builtinIds, 'a', 'b']);
  });

  it('follows the saved order, custom presets on top', () => {
    const order = ['b', 'a', ...builtinIds];
    expect(ids(orderedPresets([user('a'), user('b')], order))).toEqual(order);
  });

  it('places a new preset after the one that precedes it by default', () => {
    const order = ['a', ...builtinIds];
    expect(ids(orderedPresets([user('a'), user('new')], order))).toEqual(['a', 'new', ...builtinIds]);
  });

  it('ignores ids that no longer exist', () => {
    expect(ids(orderedPresets([user('a')], ['gone', 'a', ...builtinIds]))).toEqual(['a', ...builtinIds]);
  });
});
