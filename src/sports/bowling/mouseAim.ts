import { Vector3 } from 'three/webgpu';
import type { PerspectiveCamera } from 'three/webgpu';
import { HEAD_PIN_Z, LAYOUT } from './layout';
import { Y0 } from './world';

const ORIGIN = new Vector3();
const DIR = new Vector3();

export interface MouseAimConfig {
  maxAngle: number;
  mouseAimMinDist: number;
}

/**
 * The launch angle (radians, positive toward screen right) that points the arrows at the lane
 * point under the cursor. `px` and `py` are the cursor over the viewport, 0..1. The cursor's ray
 * is cut with the lane surface; above the horizon or beyond the head pin it is cut with the head
 * pin's depth instead. The point is never taken nearer than `mouseAimMinDist` down the lane, and
 * the angle is clamped to `maxAngle`. The screen centre is dead straight for a centred camera.
 * Allocation free: it reuses two module vectors.
 */
export function pointerAimAngle(
  camera: PerspectiveCamera,
  px: number,
  py: number,
  originX: number,
  cfg: MouseAimConfig,
): number {
  camera.updateMatrixWorld();
  ORIGIN.setFromMatrixPosition(camera.matrixWorld);
  DIR.set(px * 2 - 1, 1 - py * 2, 0.5)
    .unproject(camera)
    .sub(ORIGIN);
  if (DIR.z > -1e-6) return 0;
  let t = Number.POSITIVE_INFINITY;
  if (DIR.y < -1e-6) t = (Y0 - ORIGIN.y) / DIR.y;
  if (!(ORIGIN.z + DIR.z * t > HEAD_PIN_Z)) t = (HEAD_PIN_Z - ORIGIN.z) / DIR.z;
  const hitX = ORIGIN.x + DIR.x * t;
  let dist = LAYOUT.foulZ - (ORIGIN.z + DIR.z * t);
  if (dist < cfg.mouseAimMinDist) dist = cfg.mouseAimMinDist;
  const a = Math.atan((hitX - originX) / dist);
  return a < -cfg.maxAngle ? -cfg.maxAngle : a > cfg.maxAngle ? cfg.maxAngle : a;
}
