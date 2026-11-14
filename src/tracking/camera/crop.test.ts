import { describe, expect, it } from 'vitest';
import { computeWristCrop, createCropRect, cropToImageX, cropToImageY } from './crop';

describe('computeWristCrop', () => {
  it('centres beyond the wrist and sizes by forearm length', () => {
    const r = createCropRect();
    // 1000x1000 image, elbow (0.4,0.5), wrist (0.5,0.5): forearm 100 px.
    expect(computeWristCrop(0.5, 0.5, 0.4, 0.5, 1000, 1000, r)).toBe(true);
    expect(r.side).toBeCloseTo(180);
    // centre x = 500 + 35 = 535 -> x = 445
    expect(r.x).toBeCloseTo(445);
    expect(r.y).toBeCloseTo(410);
  });
  it('enforces the 64 px minimum', () => {
    const r = createCropRect();
    computeWristCrop(0.5, 0.5, 0.49, 0.5, 1000, 1000, r);
    expect(r.side).toBe(64);
  });
  it('clamps the side to the image and shifts the square inside', () => {
    const r = createCropRect();
    computeWristCrop(0.5, 0.5, 0.0, 0.5, 1280, 720, r);
    expect(r.side).toBe(720);
    expect(r.y).toBe(0);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.side).toBeLessThanOrEqual(1280);
  });
  it('keeps edge crops inside the image', () => {
    const r = createCropRect();
    computeWristCrop(0.99, 0.01, 0.9, 0.2, 1280, 720, r);
    expect(r.x + r.side).toBeLessThanOrEqual(1280 + 1e-9);
    expect(r.y).toBe(0);
    computeWristCrop(0.01, 0.99, 0.1, 0.8, 1280, 720, r);
    expect(r.x).toBe(0);
    expect(r.y + r.side).toBeLessThanOrEqual(720 + 1e-9);
  });
  it('rejects unusable input', () => {
    const r = createCropRect();
    expect(computeWristCrop(1.2, 0.5, 0.5, 0.5, 1280, 720, r)).toBe(false);
    expect(computeWristCrop(0.5, 0.5, 0.5, 0.5, 1280, 720, r)).toBe(false);
    expect(computeWristCrop(NaN, 0.5, 0.5, 0.5, 1280, 720, r)).toBe(false);
  });
  it('maps crop coordinates back to the image', () => {
    const r = { x: 100, y: 50, side: 200 };
    expect(cropToImageX(r, 0.5, 1000)).toBeCloseTo(0.2);
    expect(cropToImageY(r, 1, 500)).toBeCloseTo(0.5);
  });
});
