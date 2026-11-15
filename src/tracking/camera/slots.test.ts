import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  createSlotState,
  SLOT_MAX_AGE,
  SLOT_ORDER_FRAMES,
  SLOT_ORDER_SEPARATION,
} from './slots';
import type { SlotState } from './slots';

function run(state: SlotState, pts: [number, number][]): number[] {
  const out = new Int8Array(2);
  assignSlots(
    pts.map((p) => p[0]),
    pts.map((p) => p[1]),
    pts.length,
    state,
    out,
  );
  return [out[0], out[1]];
}

describe('assignSlots', () => {
  it('assigns nothing when there are no hands', () => {
    expect(run(createSlotState(), [])).toEqual([-1, -1]);
  });
  it('uses mirrored x for two fresh hands', () => {
    expect(
      run(createSlotState(), [
        [0.7, 0.5],
        [0.3, 0.5],
      ]),
    ).toEqual([1, 0]);
  });
  it('puts a lone fresh hand by side of the frame', () => {
    expect(run(createSlotState(), [[0.2, 0.5]])).toEqual([0, -1]);
    expect(run(createSlotState(), [[0.8, 0.5]])).toEqual([-1, 0]);
  });
  it('keeps the right slot when only the right hand remains, even near the middle', () => {
    const s = createSlotState();
    run(s, [
      [0.3, 0.5],
      [0.55, 0.5],
    ]);
    expect(run(s, [[0.48, 0.5]])).toEqual([-1, 0]);
  });
  it('keeps the left slot when the left hand moves past the middle alone', () => {
    const s = createSlotState();
    run(s, [[0.4, 0.5]]);
    expect(run(s, [[0.6, 0.5]])).toEqual([0, -1]);
  });
  it('follows continuity through a swap in detection order', () => {
    const s = createSlotState();
    run(s, [
      [0.4, 0.5],
      [0.45, 0.5],
    ]);
    // Detection 0 is now the rightmost hand but still nearest to slot 1.
    expect(
      run(s, [
        [0.46, 0.5],
        [0.41, 0.5],
      ]),
    ).toEqual([1, 0]);
  });
  it('forgets a slot after it has been missing too long', () => {
    const s = createSlotState();
    run(s, [[0.2, 0.5]]);
    for (let i = 0; i <= SLOT_MAX_AGE + 1; i++) run(s, []);
    expect(run(s, [[0.9, 0.5]])).toEqual([-1, 0]);
  });
  it('never puts two detections in one slot', () => {
    const r = run(createSlotState(), [
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    expect(r[0]).not.toBe(r[1]);
    expect(r.every((v) => v >= 0)).toBe(true);
  });
  it('gives a lone detection to the slot that was seen recently when both are in the gate', () => {
    const s = createSlotState();
    run(s, [
      [0.3, 0.5],
      [0.7, 0.5],
    ]);
    // The right hand is lost for a few frames; the left one keeps being seen.
    for (let i = 0; i < 5; i++) run(s, [[0.3, 0.5]]);
    // The right hand comes back, closer to the left hand's spot than to where it was last seen.
    expect(run(s, [[0.5, 0.5]])).toEqual([-1, 0]);
  });

  it('puts a long-lived wrong order right, but not a short one', () => {
    const s = createSlotState();
    // A stuck mix-up: slot 0 follows the hand at 0.6 and slot 1 the one at 0.3.
    s.x[0] = 0.6;
    s.y[0] = 0.5;
    s.x[1] = 0.3;
    s.y[1] = 0.5;
    s.seen[0] = 1;
    s.seen[1] = 1;
    expect(0.6 - 0.3).toBeGreaterThan(SLOT_ORDER_SEPARATION);
    const both: [number, number][] = [
      [0.6, 0.5],
      [0.3, 0.5],
    ];
    // Continuity keeps the mix-up for a while...
    for (let i = 0; i < SLOT_ORDER_FRAMES - 1; i++) expect(run(s, both)).toEqual([0, 1]);
    // ...and then the left slot goes to the left-most hand, and stays there.
    expect(run(s, both)).toEqual([1, 0]);
    expect(run(s, both)).toEqual([1, 0]);
  });

  it('lets hands cross and come back without exchanging slots', () => {
    const s = createSlotState();
    const up = 24;
    const total = up * 2;
    for (let i = 0; i <= total; i++) {
      const tri = i <= up ? i / up : (total - i) / up;
      const a: [number, number] = [0.4 + 0.2 * tri, 0.45];
      const b: [number, number] = [0.6 - 0.2 * tri, 0.55];
      // The detector's order alternates; the slot-0 detection must stay the hand that started left.
      const pos = i % 2 === 0 ? [a, b] : [b, a];
      const out = run(s, pos);
      expect(pos[out[0]][0], `i=${i}`).toBeCloseTo(a[0], 6);
    }
  });
});
