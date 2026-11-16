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

  describe('body scale when the player turns side-on', () => {
    /** Shoulders `width` apart about x 0.5 (hips and the rest as `standing`). */
    function turnTo(pose: Float32Array, width: number): void {
      setLm(pose, PoseIndex.LEFT_SHOULDER, 0.5 - width / 2, 0.3);
      setLm(pose, PoseIndex.RIGHT_SHOULDER, 0.5 + width / 2, 0.3);
    }

    it('does not collapse with the shoulder line: speeds stay sane', () => {
      const state = createInputState();
      state.aspect = 1;
      standing(state.pose);
      const k = new PoseKinematics(4);
      for (let i = 0; i < 10; i++) {
        state.t = i * 33;
        k.update(state, null);
      }
      expect(state.shoulderWidth).toBeCloseTo(0.16, 3);
      // Turn side-on over half a second: the shoulders overlap almost completely.
      for (let i = 10; i < 40; i++) {
        state.t = i * 33;
        turnTo(state.pose, Math.max(0.01, 0.16 * (1 - (i - 10) / 15)));
        k.update(state, null);
      }
      expect(state.shoulderWidth).toBeGreaterThan(0.11);
      // The same wrist movement reads at about the same speed as it did facing the camera.
      for (let i = 40; i < 55; i++) {
        state.t = i * 33;
        setLm(state.pose, PoseIndex.RIGHT_WRIST, 0.5, 0.6 - 0.002 * (i - 40) * 3);
        k.update(state, null);
      }
      const sideSpeed = state.arms.right.speed;
      expect(sideSpeed).toBeGreaterThan(0.6);
      expect(sideSpeed).toBeLessThan(2.5);
    });

    it('a calibrated player who is already side-on when found gets the stable scale at once', () => {
      const state = createInputState();
      state.aspect = 1;
      standing(state.pose);
      turnTo(state.pose, 0.01);
      state.t = 0;
      new PoseKinematics().update(state, calibration);
      // calibration: width 0.16 over a torso of 0.3, so about 0.8 x 0.533 x 0.3.
      expect(state.shoulderWidth).toBeGreaterThan(0.11);
      expect(state.shoulderWidth).toBeLessThan(0.16);
    });

    it('restart keeps the learned proportions, reset forgets them', () => {
      const state = createInputState();
      state.aspect = 1;
      standing(state.pose);
      const k = new PoseKinematics();
      state.t = 0;
      k.update(state, null);
      k.restart();
      turnTo(state.pose, 0.01);
      state.t = 33;
      k.update(state, null);
      expect(state.shoulderWidth).toBeGreaterThan(0.11);
      k.reset();
      state.t = 66;
      k.update(state, null);
      expect(state.shoulderWidth).toBeLessThan(0.02);
    });

    it('with no hips in view the scale is held up by the widest recent shoulder width', () => {
      const state = createInputState();
      state.aspect = 1;
      standing(state.pose);
      state.pose[PoseIndex.LEFT_HIP * POSE_STRIDE + 3] = 0;
      state.pose[PoseIndex.RIGHT_HIP * POSE_STRIDE + 3] = 0;
      const k = new PoseKinematics();
      state.t = 0;
      k.update(state, null);
      turnTo(state.pose, 0.01);
      for (let i = 1; i < 30; i++) {
        state.t = i * 33;
        k.update(state, null);
      }
      expect(state.shoulderWidth).toBeGreaterThan(0.09);
    });

    it('the far shoulder may be faint: width is simply not updated from it', () => {
      const state = createInputState();
      state.aspect = 1;
      standing(state.pose);
      const k = new PoseKinematics();
      state.t = 0;
      k.update(state, null);
      state.pose[PoseIndex.RIGHT_SHOULDER * POSE_STRIDE + 3] = 0.3;
      setLm(state.pose, PoseIndex.RIGHT_SHOULDER, 0.5, 0.3, 0.3);
      state.t = 100;
      k.update(state, null);
      expect(state.shoulderWidth).toBeCloseTo(0.16, 3);
    });

    describe('the learned shoulder-to-torso ratio is robust (median of square-on frames)', () => {
      const FRAME = 1000 / 30;
      /** A player of shoulder width `w` and torso `torso` (image units, aspect 1), torso foreshortened by `lean`, shoulders turned by `yaw`. */
      function body(
        pose: Float32Array,
        w: number,
        torso: number,
        lean: number,
        yaw: number,
        jitter: number,
      ): void {
        const sw = Math.max(0.008, w * Math.cos(yaw));
        const hw = 0.72 * sw;
        const hipY = 0.3 + torso * Math.cos(lean);
        setLm(pose, PoseIndex.LEFT_SHOULDER, 0.5 - sw / 2 + jitter, 0.3);
        setLm(pose, PoseIndex.RIGHT_SHOULDER, 0.5 + sw / 2 - jitter, 0.3 + jitter);
        setLm(pose, PoseIndex.LEFT_HIP, 0.5 - hw / 2, hipY);
        setLm(pose, PoseIndex.RIGHT_HIP, 0.5 + hw / 2, hipY - jitter);
      }

      /** Run `ms` of a posture; returns the body scale at the end. */
      function run(
        k: PoseKinematics,
        state: ReturnType<typeof createInputState>,
        clock: { t: number },
        ms: number,
        w: number,
        torso: number,
        lean: number,
        yaw: number,
        noise?: () => number,
      ): number {
        const end = clock.t + ms;
        while (clock.t < end) {
          clock.t += FRAME;
          state.t = clock.t;
          body(state.pose, w, torso, lean, yaw, noise ? (noise() - 0.5) * 0.004 : 0);
          k.update(state, null);
        }
        return state.shoulderWidth;
      }

      function fresh() {
        const state = createInputState();
        state.aspect = 1;
        return { state, k: new PoseKinematics(4), clock: { t: 0 } };
      }

      const DEG = Math.PI / 180;
      const SIDE_ON = 85 * DEG;

      it('a lean toward the camera inflates the side-on scale by only a few percent, and it recovers', () => {
        const W = 0.16;
        const T = 0.3;
        const ctrl = fresh();
        run(ctrl.k, ctrl.state, ctrl.clock, 6000, W, T, 0, 0);
        const baseline = run(ctrl.k, ctrl.state, ctrl.clock, 1500, W, T, 0, SIDE_ON);
        expect(baseline).toBeGreaterThan(0.75 * W);
        expect(baseline).toBeLessThan(0.85 * W);

        // A bowling approach: 1.5 s leaning 40 degrees toward the camera (the torso is 23% shorter).
        const a = fresh();
        run(a.k, a.state, a.clock, 6000, W, T, 0, 0);
        run(a.k, a.state, a.clock, 1500, W, T, 40 * DEG, 0);
        run(a.k, a.state, a.clock, 400, W, T, 0, 0);
        const afterLean = run(a.k, a.state, a.clock, 1500, W, T, 0, SIDE_ON);
        expect(afterLean).toBeLessThan(baseline * 1.04);
        expect(afterLean).toBeGreaterThan(baseline * 0.96);

        // Even a long lean (it outnumbers the square-on frames for a while) is forgotten again.
        const b = fresh();
        run(b.k, b.state, b.clock, 4000, W, T, 0, 0);
        run(b.k, b.state, b.clock, 9000, W, T, 40 * DEG, 0);
        run(b.k, b.state, b.clock, 14000, W, T, 0, 0);
        const recovered = run(b.k, b.state, b.clock, 1500, W, T, 0, SIDE_ON);
        expect(recovered).toBeLessThan(baseline * 1.04);
      });

      it('the old running maximum would have kept the inflation: the lean frames really do read bigger', () => {
        // Guards the test above: the lean's raw ratio is far above the true one.
        const W = 0.16;
        const T = 0.3;
        expect(W / (T * Math.cos(40 * DEG)) / (W / T)).toBeGreaterThan(1.25);
      });

      it('a narrow-shouldered player stays within 5% of their square-on width over 60 s of movement', () => {
        let seed = 12345;
        const noise = (): number => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        const W = 0.11;
        const T = 0.3;
        const { state, k, clock } = fresh();
        const seen: number[] = [];
        // Mixed movement: standing, leaning in and out, turning part-way, a few quick glances side-on.
        const moves: [number, number, number][] = [
          [0, 0, 5000],
          [35 * DEG, 0, 1000],
          [0, 0, 3000],
          [0, 30 * DEG, 1500],
          [0, 0, 4000],
          [45 * DEG, 20 * DEG, 1200],
          [0, 0, 3000],
          [0, SIDE_ON, 800],
          [0, 0, 5000],
          [30 * DEG, 0, 900],
          [0, 0, 6000],
          [40 * DEG, 0, 1500],
          [0, 45 * DEG, 1000],
          [0, 0, 5000],
          [38 * DEG, 0, 1200],
          [0, 0, 6000],
          [0, 0, 5000],
          [0, 0, 10000],
        ];
        for (const [lean, yaw, ms] of moves) {
          const s = run(k, state, clock, ms, W, T, lean, yaw, noise);
          if (lean === 0 && yaw === 0) seen.push(s);
        }
        expect(clock.t).toBeGreaterThan(60000);
        // Facing the camera the scale is the live width; it never drifted from the true one.
        for (const s of seen) {
          expect(s).toBeGreaterThan(0.95 * W);
          expect(s).toBeLessThan(1.05 * W);
        }
        // Side-on it is held up by the torso: 0.8 of the square-on width, not inflated by the leans.
        const side = run(k, state, clock, 1500, W, T, 0, SIDE_ON, noise);
        expect(side).toBeGreaterThan(0.8 * W * 0.95);
        expect(side).toBeLessThan(0.8 * W * 1.05);
      });

      it('the calibration seeds the ratio and one odd frame does not replace it', () => {
        const state = createInputState();
        state.aspect = 1;
        const k = new PoseKinematics(4);
        const cal: Calibration = { ...calibration, shoulderWidth: 0.16, centreY: 0.3, hipY: 0.6 };
        body(state.pose, 0.16, 0.3, 0, SIDE_ON, 0);
        state.t = 0;
        k.update(state, cal);
        // Side-on from the first frame: the scale comes from the calibration's ratio (0.8 x 0.16).
        expect(state.shoulderWidth).toBeGreaterThan(0.8 * 0.16 * 0.95);
        expect(state.shoulderWidth).toBeLessThan(0.8 * 0.16 * 1.05);
        // A single leaning frame at the start of square-on does not move it much.
        body(state.pose, 0.16, 0.3, 45 * DEG, 0, 0);
        state.t = 200;
        k.update(state, cal);
        body(state.pose, 0.16, 0.3, 0, SIDE_ON, 0);
        for (let i = 0; i < 30; i++) {
          state.t = 300 + i * FRAME;
          k.update(state, cal);
        }
        expect(state.shoulderWidth).toBeLessThan(0.8 * 0.16 * 1.05);
      });
    });
  });
});
