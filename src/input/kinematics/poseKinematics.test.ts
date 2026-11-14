import { describe, expect, it } from 'vitest';
import { PoseIndex, POSE_STRIDE } from '../../tracking/types';
import { createInputState } from '../state';
import type { Calibration } from '../types';
import { PoseKinematics, jointAngle, sanitizeVisibility } from './poseKinematics';

function setLm(pose: Float32Array, i: number, x: number, y: number, vis = 1): void {
  pose[i * POSE_STRIDE] = x;
  pose[i * POSE_STRIDE + 1] = y;
  pose[i * POSE_STRIDE + 3] = vis;
}

/** Standing, facing the camera, arms hanging straight down. Shoulder width 0.16 at aspect 1. */
function standing(pose: Float32Array): void {
  setLm(pose, PoseIndex.LEFT_SHOULDER, 0.42, 0.3);
  setLm(pose, PoseIndex.RIGHT_SHOULDER, 0.58, 0.3);
  setLm(pose, PoseIndex.LEFT_ELBOW, 0.42, 0.45);
  setLm(pose, PoseIndex.RIGHT_ELBOW, 0.58, 0.45);
  setLm(pose, PoseIndex.LEFT_WRIST, 0.42, 0.6);
  setLm(pose, PoseIndex.RIGHT_WRIST, 0.58, 0.6);
  setLm(pose, PoseIndex.LEFT_HIP, 0.45, 0.6);
  setLm(pose, PoseIndex.RIGHT_HIP, 0.55, 0.6);
}

const calibration: Calibration = {
  centreX: 0.5,
  centreY: 0.3,
  hipY: 0.6,
  shoulderWidth: 0.16,
  armLength: 1.5,
  handedness: 'right',
  seated: false,
};

describe('sanitizeVisibility', () => {
  it('zeroes visibility of off-image landmarks only', () => {
    const pose = new Float32Array(33 * POSE_STRIDE);
    setLm(pose, 0, 0.5, 0.5);
    setLm(pose, 1, -0.01, 0.5);
    setLm(pose, 2, 0.5, 1.2);
    setLm(pose, 3, 1, 0);
    sanitizeVisibility(pose);
    expect(pose[3]).toBe(1);
    expect(pose[7]).toBe(0);
    expect(pose[11]).toBe(0);
    expect(pose[15]).toBe(1);
  });
});

describe('jointAngle', () => {
  it('is pi for a straight arm and pi/2 for a right angle', () => {
    const pose = new Float32Array(33 * POSE_STRIDE);
    standing(pose);
    const { LEFT_SHOULDER: s, LEFT_ELBOW: e, LEFT_WRIST: w } = PoseIndex;
    expect(jointAngle(pose, s, e, w, 1)).toBeCloseTo(Math.PI, 5);
    setLm(pose, w, 0.57, 0.45);
    expect(jointAngle(pose, s, e, w, 1)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('applies aspect correction', () => {
    const pose = new Float32Array(33 * POSE_STRIDE);
    setLm(pose, 0, 0.5, 0.4);
    setLm(pose, 1, 0.5, 0.5);
    setLm(pose, 2, 0.6, 0.6);
    // Raw 2D angle is 135 degrees; at aspect 2 the x offset doubles, giving a different angle.
    expect(jointAngle(pose, 0, 1, 2, 1)).toBeCloseTo((3 * Math.PI) / 4, 5);
    expect(jointAngle(pose, 0, 1, 2, 2)).toBeCloseTo(Math.PI - Math.atan2(0.2, 0.1), 5);
  });
});

describe('PoseKinematics', () => {
  it('measures shoulder width with aspect correction and arm geometry', () => {
    const state = createInputState();
    state.aspect = 2;
    standing(state.pose);
    state.t = 1000;
    new PoseKinematics().update(state, null);
    expect(state.shoulderWidth).toBeCloseTo(0.32, 5);
    expect(state.arms.left.elbowAngle).toBeCloseTo(Math.PI, 4);
    // Left wrist is 0.3 below its shoulder: y positive up means negative.
    expect(state.arms.left.wristY).toBeCloseTo(-0.3 / 0.32, 4);
    expect(state.arms.left.wristX).toBeCloseTo(0, 5);
  });

  it('reports a bent elbow and lean, lateral signs', () => {
    const state = createInputState();
    state.aspect = 1;
    standing(state.pose);
    setLm(state.pose, PoseIndex.RIGHT_WRIST, 0.7, 0.45);
    state.t = 0;
    const k = new PoseKinematics();
    k.update(state, null);
    expect(state.arms.right.elbowAngle).toBeCloseTo(Math.PI / 2, 4);
    expect(state.arms.right.wristX).toBeGreaterThan(0);
    expect(state.lean).toBeCloseTo(0, 5);
    expect(state.lateral).toBeCloseTo(0, 5);

    // Shift shoulders to screen right of the hips.
    setLm(state.pose, PoseIndex.LEFT_SHOULDER, 0.52, 0.3);
    setLm(state.pose, PoseIndex.RIGHT_SHOULDER, 0.68, 0.3);
    state.t = 33;
    k.update(state, null);
    expect(state.lean).toBeGreaterThan(0.1);
    expect(state.lateral).toBeGreaterThan(0.5);
    setLm(state.pose, PoseIndex.LEFT_SHOULDER, 0.32, 0.3);
    setLm(state.pose, PoseIndex.RIGHT_SHOULDER, 0.48, 0.3);
    state.t = 66;
    k.update(state, null);
    expect(state.lean).toBeLessThan(-0.1);
    expect(state.lateral).toBeLessThan(-0.5);
  });

  it('uses calibration for lateral and rise', () => {
    const state = createInputState();
    state.aspect = 1;
    standing(state.pose);
    setLm(state.pose, PoseIndex.LEFT_HIP, 0.45, 0.5);
    setLm(state.pose, PoseIndex.RIGHT_HIP, 0.55, 0.5);
    state.t = 0;
    const k = new PoseKinematics();
    k.update(state, null);
    expect(state.rise).toBe(0);
    k.update(state, { ...calibration, centreX: 0.42 });
    expect(state.rise).toBeCloseTo(0.1 / 0.16, 4);
    expect(state.lateral).toBeCloseTo(0.08 / 0.16, 4);
  });

  it('does not update shoulder width when a shoulder is not visible', () => {
    const state = createInputState();
    state.aspect = 1;
    standing(state.pose);
    const k = new PoseKinematics();
    k.update(state, null);
    state.pose[PoseIndex.LEFT_SHOULDER * POSE_STRIDE + 3] = 0;
    setLm(state.pose, PoseIndex.RIGHT_SHOULDER, 0.9, 0.3, 1);
    state.pose[PoseIndex.LEFT_SHOULDER * POSE_STRIDE + 3] = 0;
    state.t = 100;
    k.update(state, null);
    expect(state.shoulderWidth).toBeCloseTo(0.16, 5);
  });

  it('gives wrist velocity in sw/s for a known constant speed', () => {
    for (const aspect of [1, 1.5]) {
      const state = createInputState();
      state.aspect = aspect;
      standing(state.pose);
      const k = new PoseKinematics(4);
      const sw = 0.16 * aspect;
      const speedX = 0.3; // normalised units per second, screen right
      const speedY = -0.2; // image y decreasing: moving up
      for (let i = 0; i < 15; i++) {
        state.t = i * (1000 / 30);
        const s = state.t / 1000;
        setLm(state.pose, PoseIndex.RIGHT_WRIST, 0.58 + speedX * s, 0.6 + speedY * s);
        k.update(state, null);
      }
      expect(state.arms.right.vx).toBeCloseTo((speedX * aspect) / sw, 3);
      expect(state.arms.right.vy).toBeCloseTo(0.2 / sw, 3);
      expect(state.arms.right.speed).toBeCloseTo(Math.hypot(speedX * aspect, 0.2) / sw, 3);
      expect(state.arms.left.speed).toBeCloseTo(0, 5);
    }
  });
});
