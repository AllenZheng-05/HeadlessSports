/**
 * Fixed alley geometry, metres. The lane runs along -z from the foul line to the head pin; the
 * bowler stands behind the foul line (z around 0). Not tunable: changing these needs a rebuild.
 */
export const LAYOUT = {
  /** World z of the foul line. */
  foulZ: -0.7,
  /** Foul line to head pin. */
  laneLength: 18.29,
  /** Half the lane width (1.05 m lane). */
  laneHalf: 0.525,
  gutterWidth: 0.235,
  /** Gutter floor height below the lane surface. */
  gutterDrop: 0.07,
  /** Approach length behind the foul line. */
  approachLength: 4.5,
  /** Pin deck length behind the head pin (pit). */
  deckBehind: 2.6,
  ballRadius: 0.108,
  pinSpacing: 0.305,
  pinHeight: 0.38,
  pinCount: 10,
} as const;

export const HEAD_PIN_Z = LAYOUT.foulZ - LAYOUT.laneLength;
/** Past this z the ball has gone through the pins (the pit). */
export const PIT_Z = HEAD_PIN_Z - 1.3;
export const BACK_WALL_Z = HEAD_PIN_Z - LAYOUT.deckBehind;

const ROW_DEPTH = LAYOUT.pinSpacing * 0.8660254;

/** Rack position of pin `i` (0 = head pin; rows of 1, 2, 3, 4). Writes x and z into `out`. */
export function rackPosition(i: number, out: { x: number; z: number }): void {
  let row = 0;
  let first = 0;
  while (i >= first + row + 1) {
    first += row + 1;
    row++;
  }
  out.x = (i - first - row / 2) * LAYOUT.pinSpacing;
  out.z = HEAD_PIN_Z - row * ROW_DEPTH;
}
