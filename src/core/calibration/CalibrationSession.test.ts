import { describe, expect, it } from 'vitest';
import { FrameProcessor } from '../../input/FrameProcessor';
import { createInputState } from '../../input/state';
import type { InputState } from '../../input/types';
import { SyntheticBody, createEmptyFrame } from '../../tracking/synthetic/body';
import { defaultControls } from '../../tracking/synthetic/controls';
import type { BodyControls } from '../../tracking/synthetic/controls';
import { CalibrationSession, calibrationConfig, defaultCalibration } from './CalibrationSession';

const ASPECT = 16 / 9;
const STEP = 1000 / 30;

class Rig {
  readonly state = createInputState();
  private readonly processor = new FrameProcessor(this.state);
  private readonly body = new SyntheticBody(ASPECT, { sigma: 0, seed: 1 });
  private readonly frame = createEmptyFrame(ASPECT);
  t = 1000;
  controls: BodyControls = defaultControls();

  constructor(
    readonly session: CalibrationSession,
    patch: Partial<BodyControls> = {},
  ) {
    Object.assign(this.controls, patch);
  }

  set(patch: Partial<BodyControls>): void {
    Object.assign(this.controls, patch);
  }

  /** Run for `ms`, one tracking frame and one session update per 33 ms. */
  run(ms: number): void {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += STEP;
      this.frame.t = this.t;
      this.frame.seq++;
      this.body.write(this.controls, this.frame);
      this.processor.process(this.frame);
      this.processor.tick(this.t);
      this.session.update(this.state, this.t);
    }
  }
}

const STAND: Partial<BodyControls> = {};
const RIGHT_UP: Partial<BodyControls> = { rightWristX: 0.35, rightWristY: 1.1 };
const LEFT_UP: Partial<BodyControls> = { leftWristX: -0.35, leftWristY: 1.1 };
const T_POSE: Partial<BodyControls> = {
  leftWristX: -1.5,
  leftWristY: 0,
  rightWristX: 1.5,
  rightWristY: 0,
};

function fullRun(rig: Rig, hand: Partial<BodyControls> = RIGHT_UP): void {
  rig.set(STAND);
  rig.run(1200);
  rig.set(hand);
  rig.run(1200);
  rig.set(T_POSE);
  rig.run(2500);
}

describe('CalibrationSession full body', () => {
  it('walks through the steps and measures the synthetic player (right hand)', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    rig.run(40);
    const view = rig.session.update(rig.state, rig.t);
    expect(view.step).toBe('position');
    expect(view.message).toBe('Step back until your whole body is inside the outline');
    rig.run(1200);
    expect(rig.session.done).toBe(false);
    expect(view.step).toBe('handedness');
    expect(view.message).toBe('Raise your dominant hand');
    rig.set(RIGHT_UP);
    rig.run(1200);
    expect(view.step).toBe('hold-still');
    expect(view.handedness).toBe('right');
    rig.set(T_POSE);
    rig.run(2500);
    expect(rig.session.done).toBe(true);
    expect(view.step).toBe('done');
    expect(view.message).toBe('All set');
    expect(view.ok).toBe(true);
    expect(view.progress).toBe(1);
    const cal = rig.session.result();
    expect(cal).not.toBeNull();
    expect(cal?.handedness).toBe('right');
    expect(cal?.seated).toBe(false);
    expect(cal?.shoulderWidth).toBeCloseTo(0.13, 2);
    expect(cal?.centreX).toBeCloseTo(0.5, 2);
    expect(cal?.centreY).toBeCloseTo(0.32, 2);
    expect(cal?.armLength).toBeGreaterThan(1.4);
    expect(cal?.armLength).toBeLessThan(1.6);
    expect(cal?.hipY).toBeGreaterThan(0.45);
    expect(cal?.hipY).toBeLessThan(0.6);
  });

  it('picks the left hand when the left arm is raised', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    fullRun(rig, LEFT_UP);
    expect(rig.session.result()?.handedness).toBe('left');
  });

  it('returns the same view object every call', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const a = rig.session.update(rig.state, 0);
    rig.run(500);
    const b = rig.session.update(rig.state, rig.t + 10);
    expect(b).toBe(a);
    fullRun(rig);
    expect(rig.session.update(rig.state, rig.t + 10)).toBe(a);
  });

  it('fills progress during the hold and resets it when the player steps out', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const view = rig.session.update(rig.state, rig.t);
    rig.run(400);
    expect(view.step).toBe('position');
    expect(view.progress).toBeGreaterThan(0.3);
    expect(view.ok).toBe(true);
    rig.set({ centreX: 0.93 });
    rig.run(300);
    expect(view.ok).toBe(false);
    expect(view.progress).toBe(0);
    expect(view.hint).toBe('Move left');
    rig.set({ centreX: 0.5 });
    rig.run(300);
    expect(view.step).toBe('position');
    expect(view.progress).toBeGreaterThan(0);
    expect(view.progress).toBeLessThan(0.7);
  });

  it('hints to step back when too close and come closer when too far', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const view = rig.session.update(rig.state, rig.t);
    rig.set({ shoulderWidth: 0.32, shoulderY: 0.12 });
    rig.run(1500);
    expect(view.step).toBe('position');
    expect(view.hint).toBe('Step back a little');
    const far = new Rig(new CalibrationSession('full-body'), {
      shoulderWidth: 0.05,
      shoulderY: 0.4,
    });
    far.run(300);
    const view2 = far.session.update(far.state, far.t);
    expect(view2.hint).toBe('Come a little closer');
    expect(view2.ok).toBe(false);
  });

  it('shows the dark hint and unblocks after the maximum wait', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const view = rig.session.update(rig.state, rig.t);
    rig.session.setBrightness(0.05);
    rig.run(1100);
    expect(view.step).toBe('lighting');
    expect(view.hint).toBe('It is a bit dark. Turn on a light or face a window.');
    rig.run(1000);
    expect(view.step).toBe('lighting');
    rig.run(calibrationConfig.lightingMaxWaitMs);
    expect(view.step).toBe('handedness');
    expect(view.hint).toBeNull();
  });

  it('moves on as soon as the light improves, and never blocks on unknown brightness', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const view = rig.session.update(rig.state, rig.t);
    rig.session.setBrightness(0.05);
    rig.run(1100);
    expect(view.step).toBe('lighting');
    rig.session.setBrightness(0.5);
    rig.run(100);
    expect(view.step).toBe('handedness');

    const rig2 = new Rig(new CalibrationSession('full-body'));
    rig2.session.setBrightness(null);
    rig2.run(1100);
    expect(rig2.session.update(rig2.state, rig2.t).step).toBe('handedness');
  });

  it('does not pick a hand when both arms are raised', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const view = rig.session.update(rig.state, rig.t);
    rig.run(1200);
    rig.set({ ...RIGHT_UP, ...LEFT_UP });
    rig.run(2000);
    expect(view.step).toBe('handedness');
    expect(view.handedness).toBeNull();
    rig.set({ leftWristX: -0.12, leftWristY: -1.4 });
    rig.run(1000);
    expect(view.handedness).toBe('right');
  });

  it('pauses on lost tracking without resetting completed steps, then continues', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    const view = rig.session.update(rig.state, rig.t);
    rig.run(1200);
    rig.set(RIGHT_UP);
    rig.run(1200);
    expect(view.step).toBe('hold-still');
    rig.set({ bodyVisible: 0 });
    rig.run(1500);
    expect(view.step).toBe('hold-still');
    expect(view.message).toBe('We cannot see you. Step into view.');
    expect(view.ok).toBe(false);
    rig.set({ bodyVisible: 1, ...T_POSE });
    rig.run(3000);
    expect(rig.session.done).toBe(true);
    expect(rig.session.result()?.handedness).toBe('right');
  });

  it('accepts the averages with the default arm length if the arms never go out', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    rig.run(1200);
    rig.set(RIGHT_UP);
    rig.run(1200);
    rig.set({ rightWristX: 0.12, rightWristY: -1.4 });
    rig.run(7000);
    expect(rig.session.done).toBe(true);
    const cal = rig.session.result();
    expect(cal?.armLength).toBe(1.5);
    expect(cal?.shoulderWidth).toBeCloseTo(0.13, 2);
  });

  it('skip returns defaults merged with measurements', () => {
    const rig = new Rig(new CalibrationSession('full-body', { defaultHandedness: 'left' }), {
      centreX: 0.42,
    });
    rig.run(300);
    const cal = rig.session.skip(rig.state);
    expect(rig.session.done).toBe(true);
    expect(rig.session.result()).toBe(cal);
    expect(cal.handedness).toBe('left');
    expect(cal.centreX).toBeCloseTo(0.42, 2);
    expect(cal.armLength).toBe(1.5);
    expect(rig.session.update(rig.state, rig.t).step).toBe('done');
  });

  it('skip with no data gives the stance defaults', () => {
    const session = new CalibrationSession('full-body');
    const cal = session.skip(createInputState());
    expect(cal).toEqual(defaultCalibration('full-body'));
  });

  it('usesHandedness false never asks for a raised hand and keeps the default hand', () => {
    const rig = new Rig(
      new CalibrationSession('full-body', { usesHandedness: false, defaultHandedness: 'left' }),
    );
    const seen = new Set<string>();
    rig.set(STAND);
    for (let i = 0; i < 20; i++) {
      rig.run(100);
      seen.add(rig.session.update(rig.state, rig.t).step);
    }
    expect(seen.has('handedness')).toBe(false);
    expect(seen.has('hold-still')).toBe(true);
    rig.set(T_POSE);
    rig.run(3000);
    expect(rig.session.done).toBe(true);
    expect(rig.session.result()?.handedness).toBe('left');
  });

  it('finishes with defaults at the timeout', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    rig.set({ bodyVisible: 0 });
    const view = rig.session.update(rig.state, rig.t);
    rig.run(calibrationConfig.timeoutMs + 100);
    expect(rig.session.done).toBe(true);
    expect(view.step).toBe('done');
    expect(rig.session.result()).toEqual(defaultCalibration('full-body'));
  });

  it('reset starts over', () => {
    const rig = new Rig(new CalibrationSession('full-body'));
    fullRun(rig);
    expect(rig.session.done).toBe(true);
    rig.session.reset();
    expect(rig.session.done).toBe(false);
    expect(rig.session.result()).toBeNull();
    expect(rig.session.update(rig.state, rig.t).step).toBe('position');
  });
});

describe('CalibrationSession other stances', () => {
  it('upper-body accepts a close player whose legs are out of frame', () => {
    const rig = new Rig(new CalibrationSession('upper-body'), {
      shoulderWidth: 0.3,
      shoulderY: 0.25,
    });
    rig.run(40);
    const view = rig.session.update(rig.state, rig.t);
    expect(view.message).toBe('Sit or stand so your shoulders and arms are in view');
    rig.run(1200);
    expect(view.step).toBe('handedness');
    rig.set({ rightWristX: 0.2, rightWristY: 1 });
    rig.run(1200);
    rig.set(T_POSE);
    rig.run(2500);
    expect(rig.session.done).toBe(true);
    const cal = rig.session.result();
    expect(cal?.shoulderWidth).toBeCloseTo(0.3, 2);
    expect(cal?.handedness).toBe('right');
  });

  it('seated relaxes full-body to the upper-body requirements and is recorded', () => {
    const rig = new Rig(new CalibrationSession('full-body', { seated: true }), {
      shoulderWidth: 0.3,
      shoulderY: 0.25,
    });
    rig.run(1200);
    expect(rig.session.update(rig.state, rig.t).step).toBe('handedness');
    rig.set({ leftWristX: -0.2, leftWristY: 1 });
    rig.run(1200);
    rig.set(T_POSE);
    rig.run(2500);
    expect(rig.session.result()?.seated).toBe(true);
    expect(rig.session.result()?.handedness).toBe('left');

    const strict = new Rig(new CalibrationSession('full-body'), {
      shoulderWidth: 0.3,
      shoulderY: 0.25,
    });
    strict.run(2000);
    expect(strict.session.update(strict.state, strict.t).step).toBe('position');
  });

  it('hands-close needs both hands, skips handedness and measures the palm midpoint', () => {
    const hands: Partial<BodyControls> = {
      handsOnly: 1,
      leftHandX: 0.3,
      leftHandY: 0.5,
      rightHandX: 0.7,
      rightHandY: 0.6,
    };
    const rig = new Rig(new CalibrationSession('hands-close', { defaultHandedness: 'left' }), {
      ...hands,
      rightHandVisible: 0,
    });
    rig.run(40);
    rig.run(40);
    const view = rig.session.update(rig.state, rig.t);
    expect(view.message).toBe('Sit or stand close with both hands in view');
    rig.run(1500);
    expect(view.step).toBe('position');
    expect(view.ok).toBe(false);
    rig.set({ rightHandVisible: 1 });
    rig.run(1000);
    expect(view.step).toBe('hold-still');
    expect(view.message).toBe('Hold both hands still');
    expect(view.handedness).toBe('left');
    rig.run(1500);
    expect(rig.session.done).toBe(true);
    const cal = rig.session.result();
    expect(cal?.handedness).toBe('left');
    expect(cal?.shoulderWidth).toBe(0);
    expect(cal?.armLength).toBe(0);
    expect(cal?.centreX).toBeCloseTo(0.5, 1);
    expect(cal?.centreY).toBeCloseTo(0.55, 1);
  });

  it('works with hand-built states', () => {
    const state: InputState = createInputState();
    state.tracking = true;
    state.problem = 'none';
    state.hands.left.present = true;
    state.hands.right.present = true;
    state.hands.left.x = 0.4;
    state.hands.left.y = 0.5;
    state.hands.right.x = 0.6;
    state.hands.right.y = 0.5;
    const s = new CalibrationSession('hands-close');
    for (let t = 0; t < 4000; t += 33) s.update(state, t);
    expect(s.done).toBe(true);
    expect(s.result()?.centreX).toBeCloseTo(0.5, 6);
    expect(s.result()?.handedness).toBe('right');
  });
});

describe('defaultCalibration', () => {
  it('gives sensible values per stance', () => {
    const full = defaultCalibration('full-body', 'left');
    expect(full.handedness).toBe('left');
    expect(full.hipY).toBeGreaterThan(full.centreY);
    expect(full.armLength).toBe(1.5);
    expect(defaultCalibration('hands-close').shoulderWidth).toBe(0);
  });
});
