/** Ring width for a face of `radius` metres: ten equal rings. */
export function ringWidth(radius: number): number {
  return radius / 10;
}

/**
 * Score for an arrow whose shaft centre is `r` metres from the centre of the face: 10 at the middle
 * down to 1 at the edge, 0 outside. A line-cutter (within `tolerance` outside a ring) scores the
 * higher ring.
 */
export function ringScore(r: number, radius: number, tolerance: number): number {
  const w = ringWidth(radius);
  for (let n = 1; n <= 10; n++) {
    if (r <= n * w + tolerance) return 11 - n;
  }
  return 0;
}

/**
 * Ring colours from the outside (ring 1) in (ring 10): white, black, blue, red, gold, each pair
 * with a lighter or darker shade so that every ring reads on its own.
 */
export const RING_COLORS: readonly number[] = [
  0xfbf8f1, 0xe4e0d4, 0x27364a, 0x45566e, 0x3f95d8, 0x78bdee, 0xe0483f, 0xf47a6d, 0xf6c93a,
  0xffe680,
];
