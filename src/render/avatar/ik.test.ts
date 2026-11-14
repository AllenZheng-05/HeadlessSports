import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { solveTwoBone } from './ik';

const L1 = 0.27;
const L2 = 0.25;

describe('solveTwoBone', () => {
  it('reaches a reachable target, preserves bone lengths, bends toward the pole', () => {
    const root = new Vector3(0, 1, 0);
    const target = new Vector3(0.3, 1.1, -0.2);
    const pole = new Vector3(0.1, 0.5, 0);
    const mid = new Vector3();
    const end = new Vector3();
    expect(solveTwoBone(root, target, pole, L1, L2, mid, end)).toBe(true);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(mid.distanceTo(root)).toBeCloseTo(L1, 5);
    expect(end.distanceTo(mid)).toBeCloseTo(L2, 5);
    // mid is on the pole side of the root-target line
    const axis = target.clone().sub(root).normalize();
    const toPole = pole.clone().sub(root);
    toPole.addScaledVector(axis, -toPole.dot(axis));
    const midOff = mid.clone().sub(root);
    midOff.addScaledVector(axis, -midOff.dot(axis));
    expect(midOff.dot(toPole)).toBeGreaterThan(0);
  });

  it('clamps an out-of-reach target along the line', () => {
    const root = new Vector3(0, 1, 0);
    const target = new Vector3(2, 1, 0);
    const mid = new Vector3();
    const end = new Vector3();
    expect(solveTwoBone(root, target, new Vector3(0, 0, 0), L1, L2, mid, end)).toBe(false);
    expect(end.x).toBeCloseTo(L1 + L2, 5);
    expect(end.y).toBeCloseTo(1, 5);
    expect(end.z).toBeCloseTo(0, 5);
  });

  it('does not produce NaN when the target is at the root', () => {
    const root = new Vector3(0.2, 1, 0);
    const mid = new Vector3();
    const end = new Vector3();
    solveTwoBone(root, root.clone(), new Vector3(0, 0, 1), L1, L2, mid, end);
    for (const v of [mid, end]) expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
    expect(mid.distanceTo(root)).toBeCloseTo(L1, 5);
  });

  it('does not produce NaN when the pole is collinear', () => {
    const root = new Vector3(0, 0, 0);
    const mid = new Vector3();
    const end = new Vector3();
    solveTwoBone(root, new Vector3(0, 0.4, 0), new Vector3(0, 2, 0), L1, L2, mid, end);
    for (const v of [mid, end]) expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
    expect(mid.distanceTo(root)).toBeCloseTo(L1, 5);
    expect(end.distanceTo(mid)).toBeCloseTo(L2, 5);
    solveTwoBone(root, new Vector3(0, 0.4, 0), new Vector3(0, 0, 0), L1, L2, mid, end);
    expect(Number.isFinite(mid.x + mid.y + mid.z)).toBe(true);
  });
});
