import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, PALETTE } from './palette';

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0').toUpperCase();

describe('palette', () => {
  const design = readFileSync('docs/DESIGN.md', 'utf8').toUpperCase();
  it('matches docs/DESIGN.md', () => {
    for (const key of [
      'sky',
      'turf',
      'turfLight',
      'turfShadow',
      'chalk',
      'putty',
      'whistle',
      'ink',
      'ink2',
    ] as const) {
      expect(design, key).toContain(hex(PALETTE[key]));
    }
    for (const key of ['climbing', 'bowling', 'archery', 'javelin'] as const) {
      expect(design, key).toContain(hex(ACCENTS[key]));
    }
  });
  it('has the exact brief values', () => {
    expect(PALETTE.sky).toBe(0xbfe3f7);
    expect(PALETTE.whistle).toBe(0xff7a59);
    expect(PALETTE.putty).toBe(0xf4f1ea);
  });
});
