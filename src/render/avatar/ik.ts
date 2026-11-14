import type { Vector3 } from 'three/webgpu';

const EPS = 1e-9;

/**
 * Analytic two-bone IK. Given the root position, a target, a pole (bend hint) position and bone lengths,
 * writes the mid-joint position to outMid and the (reach-clamped) end position to outEnd. No allocation.
 * Returns false when the target was out of reach (or inside the minimum reach) and had to be clamped.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  pole: Vector3,
  len1: number,
  len2: number,
  outMid: Vector3,
  outEnd: Vector3,
): boolean {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < EPS) {
    // Degenerate: choose a direction from the pole, else straight down.
    dx = pole.x - root.x;
    dy = pole.y - root.y;
    dz = pole.z - root.z;
    const pl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (pl < EPS) {
      dx = 0;
      dy = -1;
      dz = 0;
    } else {
      dx /= pl;
      dy /= pl;
      dz /= pl;
    }
    dist = 0;
  } else {
    dx /= dist;
    dy /= dist;
    dz /= dist;
  }

  const maxReach = len1 + len2;
  const minReach = Math.abs(len1 - len2) + 1e-6;
  let reachable = true;
  if (dist > maxReach) {
    dist = maxReach;
    reachable = false;
  } else if (dist < minReach) {
    dist = minReach;
    reachable = false;
  }

  // Distance along the root->target axis to the elbow's foot point, and the elbow's offset from the axis.
  const a = (len1 * len1 - len2 * len2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, len1 * len1 - a * a));

  // Component of the pole direction perpendicular to the axis.
  let px = pole.x - root.x;
  let py = pole.y - root.y;
  let pz = pole.z - root.z;
  const along = px * dx + py * dy + pz * dz;
  px -= dx * along;
  py -= dy * along;
  pz -= dz * along;
  let pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl < 1e-6) {
    // Pole collinear with the axis: pick any perpendicular (cross with the least-aligned world axis).
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    let ux = 0;
    let uy = 0;
    let uz = 0;
    if (ay <= ax && ay <= az) uy = 1;
    else if (ax <= az) ux = 1;
    else uz = 1;
    px = dy * uz - dz * uy;
    py = dz * ux - dx * uz;
    pz = dx * uy - dy * ux;
    pl = Math.sqrt(px * px + py * py + pz * pz);
  }
  px /= pl;
  py /= pl;
  pz /= pl;

  outMid.set(root.x + dx * a + px * h, root.y + dy * a + py * h, root.z + dz * a + pz * h);
  outEnd.set(root.x + dx * dist, root.y + dy * dist, root.z + dz * dist);
  return reachable;
}
