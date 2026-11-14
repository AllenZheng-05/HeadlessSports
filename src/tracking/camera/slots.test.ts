import { describe, expect, it } from 'vitest';
import { assignSlots, createSlotState, SLOT_MAX_AGE } from './slots';
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
});
