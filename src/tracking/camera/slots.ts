/**
 * Assigns up to two full-frame hand detections to the [left, right] slots. Pure and
 * allocation-free. Coordinates are MIRRORED normalised, so a smaller x is the player's left.
 * MediaPipe's handedness label is deliberately ignored.
 */

export const SLOT_GATE = 0.25;
export const SLOT_MAX_AGE = 10;

export interface SlotState {
  /** Last known palm position per slot. */
  x: Float32Array;
  y: Float32Array;
  /** Frames since the slot last had a detection; a slot is tracked while age <= SLOT_MAX_AGE. */
  age: Int32Array;
  /** Whether the slot has ever been seen. */
  seen: Uint8Array;
}

export function createSlotState(): SlotState {
  return {
    x: new Float32Array(2),
    y: new Float32Array(2),
    age: new Int32Array(2),
    seen: new Uint8Array(2),
  };
}

export function resetSlotState(s: SlotState): void {
  s.seen[0] = 0;
  s.seen[1] = 0;
  s.age[0] = 0;
  s.age[1] = 0;
}

function tracked(s: SlotState, slot: number): boolean {
  return s.seen[slot] === 1 && s.age[slot] <= SLOT_MAX_AGE;
}

function dist(s: SlotState, slot: number, x: number, y: number): number {
  const dx = s.x[slot] - x;
  const dy = s.y[slot] - y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * `dx`/`dy` hold `n` (0..2) detection palm positions. Writes the detection index for each slot
 * into `out` (-1 when the slot has no detection) and updates `state`.
 */
export function assignSlots(
  dx: ArrayLike<number>,
  dy: ArrayLike<number>,
  n: number,
  state: SlotState,
  out: Int8Array,
  gate: number = SLOT_GATE,
): void {
  out[0] = -1;
  out[1] = -1;
  const count = n > 2 ? 2 : n;
  const t0 = tracked(state, 0);
  const t1 = tracked(state, 1);

  if (count === 1) {
    const x = dx[0];
    const y = dy[0];
    const d0 = t0 ? dist(state, 0, x, y) : Infinity;
    const d1 = t1 ? dist(state, 1, x, y) : Infinity;
    if (d0 <= gate || d1 <= gate) {
      out[d0 <= d1 ? 0 : 1] = 0;
    } else if (t0 && !t1) {
      // The only tracked slot is far away: this is the other hand.
      out[1] = 0;
    } else if (t1 && !t0) {
      out[0] = 0;
    } else {
      out[x < 0.5 ? 0 : 1] = 0;
    }
  } else if (count === 2) {
    // Straight: det0->slot0, det1->slot1. Swapped: the reverse. Score only gated, tracked pairs.
    let straight = 0;
    let swapped = 0;
    let straightHits = 0;
    let swappedHits = 0;
    if (t0) {
      const a = dist(state, 0, dx[0], dy[0]);
      const b = dist(state, 0, dx[1], dy[1]);
      if (a <= gate) {
        straight += a;
        straightHits++;
      }
      if (b <= gate) {
        swapped += b;
        swappedHits++;
      }
    }
    if (t1) {
      const a = dist(state, 1, dx[1], dy[1]);
      const b = dist(state, 1, dx[0], dy[0]);
      if (a <= gate) {
        straight += a;
        straightHits++;
      }
      if (b <= gate) {
        swapped += b;
        swappedHits++;
      }
    }
    let swap: boolean;
    if (straightHits === 0 && swappedHits === 0) {
      swap = dx[0] > dx[1];
    } else if (straightHits !== swappedHits) {
      swap = swappedHits > straightHits;
    } else {
      swap = swapped < straight;
    }
    out[swap ? 1 : 0] = 0;
    out[swap ? 0 : 1] = 1;
  }

  for (let s = 0; s < 2; s++) {
    const d = out[s];
    if (d >= 0) {
      state.x[s] = dx[d];
      state.y[s] = dy[d];
      state.age[s] = 0;
      state.seen[s] = 1;
    } else if (state.age[s] <= SLOT_MAX_AGE) {
      state.age[s]++;
    }
  }
}
