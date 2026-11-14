import { describe, expect, it, vi } from 'vitest';
import { createInputState } from '../input/state';
import type { AvatarRig } from '../render/avatar/AvatarRig';
import { mirrorUpperBody } from './avatarDrive';

function fakeAvatar() {
  const setUpperBodyFromPose = vi.fn();
  const setMittCurl = vi.fn();
  return {
    rig: { setUpperBodyFromPose, setMittCurl } as unknown as AvatarRig,
    setUpperBodyFromPose,
    setMittCurl,
  };
}

function tracked() {
  const state = createInputState();
  state.hasPose = true;
  state.tracking = true;
  state.tPrev = 100;
  state.t = 200;
  return state;
}

describe('mirrorUpperBody', () => {
  it('leaves the arms alone without a pose but still curls the mitts', () => {
    const { rig, setUpperBodyFromPose, setMittCurl } = fakeAvatar();
    const state = createInputState();
    state.hands.right.closed = true;
    mirrorUpperBody(rig, state, 500);
    expect(setUpperBodyFromPose).not.toHaveBeenCalled();
    expect(setMittCurl).toHaveBeenCalledWith('right', 1);
    expect(setMittCurl).toHaveBeenCalledWith('left', 0);
  });

  it('interpolates between the two latest poses', () => {
    const { rig, setUpperBodyFromPose } = fakeAvatar();
    const state = tracked();
    mirrorUpperBody(rig, state, 250);
    expect(setUpperBodyFromPose.mock.calls[0]![2]).toBeCloseTo(0.5, 9);
  });

  it('clamps alpha to [0, maxAlpha]', () => {
    const { rig, setUpperBodyFromPose } = fakeAvatar();
    const state = tracked();
    mirrorUpperBody(rig, state, 100);
    mirrorUpperBody(rig, state, 900);
    mirrorUpperBody(rig, state, 900, 1.5);
    const alphas = setUpperBodyFromPose.mock.calls.map((c) => c[2] as number);
    expect(alphas).toEqual([0, 1, 1.5]);
  });
});
