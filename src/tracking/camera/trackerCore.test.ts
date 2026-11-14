import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAND_COUNT, POSE_COUNT, PoseIndex } from '../types';
import { H_HAND_PRESENT, PACKED_LEN } from './protocol';
import { TrackerCore } from './trackerCore';

class FakeCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return { drawImage: () => undefined, fillRect: () => undefined, fillStyle: '' };
  }
  transferToImageBitmap() {
    return null;
  }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function makeCore(mode: 'both' | 'alternate') {
  const core = new TrackerCore(
    {
      wasmBase: '',
      modelBase: '',
      poseModel: 'lite',
      delegate: 'CPU',
      handCropMode: mode,
      poseInputWidth: 320,
      handCropSize: 64,
    },
    false,
  );
  const lms = Array.from({ length: POSE_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  lms[PoseIndex.LEFT_WRIST] = { x: 0.3, y: 0.5, z: 0, visibility: 0.9 };
  lms[PoseIndex.LEFT_ELBOW] = { x: 0.3, y: 0.7, z: 0, visibility: 0.9 };
  lms[PoseIndex.RIGHT_WRIST] = { x: 0.7, y: 0.5, z: 0, visibility: 0.9 };
  lms[PoseIndex.RIGHT_ELBOW] = { x: 0.7, y: 0.7, z: 0, visibility: 0.9 };
  const world = Array.from({ length: POSE_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
  const hand = Array.from({ length: HAND_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const priv = core as unknown as Record<string, unknown>;
  priv.pose = { detectForVideo: () => ({ landmarks: [lms], worldLandmarks: [world] }) };
  priv.handCrop = { detect: () => ({ landmarks: [hand], handedness: [[{ score: 0.9 }]] }) };
  priv.needs = { pose: true, handCrops: true, fullFrameHands: false };
  return core;
}

const bitmap = { width: 640, height: 360 } as unknown as ImageBitmap;

describe('TrackerCore handCropMode', () => {
  it("'both' observes both hands every frame", () => {
    const core = makeCore('both');
    const out = new Float32Array(PACKED_LEN);
    for (let f = 0; f < 4; f++) {
      core.process(bitmap, f * 33, out);
      expect(out[H_HAND_PRESENT]).toBe(1);
      expect(out[H_HAND_PRESENT + 2]).toBe(1);
    }
  });

  it("'alternate' reports the hand that was not cropped this frame as absent", () => {
    const core = makeCore('alternate');
    const out = new Float32Array(PACKED_LEN);
    for (let f = 0; f < 6; f++) {
      core.process(bitmap, f * 33, out);
      const cropped = f & 1;
      expect(out[H_HAND_PRESENT + 2 * cropped]).toBe(1);
      expect(out[H_HAND_PRESENT + 2 * (1 - cropped)]).toBe(0);
    }
  });
});
