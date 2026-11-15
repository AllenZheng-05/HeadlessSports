import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { bowlingConfig } from './config';
import { LAYOUT } from './layout';
import { pointerAimAngle } from './mouseAim';
import { Y0 } from './world';

/** The camera as the bowling view leaves it in the aim phase. */
function behindCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(bowlingConfig.cameraFov, 16 / 9, 0.1, 100);
  cam.position.set(0, bowlingConfig.cameraHeight, bowlingConfig.cameraBack);
  cam.lookAt(0, 0.5, -10);
  cam.updateMatrixWorld();
  return cam;
}

describe('pointerAimAngle', () => {
  const cam = behindCamera();
  const cfg = { ...bowlingConfig };

  it('is dead straight with the cursor on the centre line', () => {
    expect(Math.abs(pointerAimAngle(cam, 0.5, 0.6, 0, cfg))).toBeLessThan(1e-9);
    expect(Math.abs(pointerAimAngle(cam, 0.5, 0.2, 0, cfg))).toBeLessThan(1e-9);
  });

  it('turns toward the side of the cursor and grows as it moves out', () => {
    const a = pointerAimAngle(cam, 0.52, 0.6, 0, cfg);
    const b = pointerAimAngle(cam, 0.55, 0.6, 0, cfg);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(pointerAimAngle(cam, 0.48, 0.6, 0, cfg)).toBeCloseTo(-a, 9);
  });

  it('points the arrows at the lane point under the cursor', () => {
    // Project a lane point 10 m down the lane and 0.2 m right; the cursor over it aims at it.
    const x = 0.2;
    const z = LAYOUT.foulZ - 10;
    const ndc = new Vector3(x, Y0, z).project(cam);
    const angle = pointerAimAngle(cam, (ndc.x + 1) / 2, (1 - ndc.y) / 2, 0, cfg);
    expect(angle).toBeCloseTo(Math.atan(x / 10), 4);
  });

  it('is clamped to the max angle', () => {
    expect(pointerAimAngle(cam, 1, 0.6, 0, cfg)).toBe(cfg.maxAngle);
    expect(pointerAimAngle(cam, 0, 0.6, 0, cfg)).toBe(-cfg.maxAngle);
  });

  it('works for a cursor above the horizon', () => {
    const a = pointerAimAngle(cam, 0.505, 0.02, 0, cfg);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
  });
});
