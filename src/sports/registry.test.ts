import { describe, expect, it } from 'vitest';
import { SPORTS, findSport } from './registry';

describe('registry', () => {
  it('hides the warm-up from the menu list but finds it by id', () => {
    expect(SPORTS.some((s) => s.meta.id === 'warmup')).toBe(false);
    expect(findSport('warmup')?.meta.title).toBe('Warm-up');
  });

  it('returns null for unknown ids', () => {
    expect(findSport('nope')).toBeNull();
  });

  it('gives every entry a unique id', () => {
    const ids = SPORTS.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
