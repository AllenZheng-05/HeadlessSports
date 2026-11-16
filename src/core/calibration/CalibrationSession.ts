import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { Calibration, InputState, Side } from '../../input/types';
import type { CalibrationView } from '../../ui/types';
import type { Stance } from '../sport';

export interface CalibrationConfig {
  positionHoldMs: number;
  handednessHoldMs: number;
  measureMs: number;
  /** Mean luma 0..1 below which the lighting hint shows. */
  lightingWarnBelow: number;
  /** Lighting never blocks longer than this. */
  lightingMaxWaitMs: number;
  /** Landmarks must be this far inside the image. */
  margin: number;
  /** Aspect-corrected units: fractions of image height. */
  minShoulderWidth: number;
  maxShoulderWidth: number;
  /** wristY in sw above which an arm counts as raised. */
  raiseAbove: number;
  /** After this, finish with defaults so nobody is stuck. */
  timeoutMs: number;
}

export const calibrationConfig: CalibrationConfig = {
  positionHoldMs: 700,
  handednessHoldMs: 450,
  measureMs: 900,
  lightingWarnBelow: 0.22,
  lightingMaxWaitMs: 2500,
  margin: 0.04,
  minShoulderWidth: 0.07,
  maxShoulderWidth: 0.3,
  raiseAbove: 0.75,
  timeoutMs: 45000,
};

/** Upper-body stances accept a closer player. */
const UPPER_BODY_MAX_SHOULDER_WIDTH = 0.45;
/** Arms-out pose for the hold-still measurement. */
const ARMS_OUT_MAX_ABS_Y = 0.45;
const ARMS_OUT_MIN_ABS_X = 0.9;
/** How long the arms-out pose may take before we accept what we have. */
const ARMS_OUT_GIVE_UP_MS = 6000;
const DEFAULT_ARM_LENGTH = 1.5;
/** Hands count as still below this speed (sw per second). */
const HANDS_STILL_SPEED = 2.5;
/** Longest frame gap counted as elapsed time, so a stalled tab cannot skip a hold. */
const MAX_DT_MS = 250;
const MIN_VISIBILITY = 0.5;
/** Hip midpoint below shoulder midpoint, in sw, when hips are not in view. */
const TORSO_SW = 1.45;

const MSG_POSITION_FULL = 'Step back until your whole body is inside the outline';
const MSG_POSITION_UPPER = 'Sit or stand so your shoulders and arms are in view';
const MSG_POSITION_HANDS = 'Sit or stand close with both hands in view';
const MSG_LIGHTING = 'Checking the light';
const MSG_HANDEDNESS = 'Raise your dominant hand';
const MSG_HOLD_POSE = 'Now hold your arms out to the sides';
const MSG_HOLD_HANDS = 'Hold both hands still';
const MSG_DONE = 'All set';
const MSG_LOST = 'We cannot see you. Step into view.';
const HINT_STEP_BACK = 'Step back a little';
const HINT_CLOSER = 'Come a little closer';
const HINT_LEFT = 'Move left';
const HINT_RIGHT = 'Move right';
const HINT_DARK = 'It is a bit dark. Turn on a light or face a window.';

type PositionKind = 'full-body' | 'upper-body' | 'hands-close';

/** A sensible calibration when none was measured (debug input, skip with no data). */
export function defaultCalibration(stance: Stance, handedness: Side = 'right'): Calibration {
  if (stance === 'hands-close') {
    return {
      centreX: 0.5,
      centreY: 0.5,
      hipY: 0.5,
      shoulderWidth: 0,
      armLength: 0,
      handedness,
      seated: false,
    };
  }
  const shoulderWidth = stance === 'full-body' ? 0.13 : 0.18;
  const centreY = stance === 'full-body' ? 0.32 : 0.38;
  return {
    centreX: 0.5,
    centreY,
    hipY: centreY + TORSO_SW * shoulderWidth,
    shoulderWidth,
    armLength: DEFAULT_ARM_LENGTH,
    handedness,
    seated: false,
  };
}

/** Mean luma 0..1 of the current video frame, sampled through a small scratch 2D context (32x18). Null if the video has no frame yet. */
export function measureBrightness(
  video: HTMLVideoElement,
  scratch: CanvasRenderingContext2D,
): number | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  try {
    scratch.drawImage(video, 0, 0, 32, 18);
    const data = scratch.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    const n = 32 * 18;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    }
    return sum / (n * 255);
  } catch {
    return null;
  }
}

export class CalibrationSession {
  private readonly seated: boolean;
  private readonly config: CalibrationConfig;
  private readonly defaultHandedness: Side;
  private readonly usesHandedness: boolean;
  private readonly kind: PositionKind;
  private readonly view: CalibrationView = {
    step: 'position',
    message: '',
    hint: null,
    progress: 0,
    ok: false,
    problem: 'none',
    handedness: null,
  };

  private brightness: number | null = null;
  private finished = false;
  private calibration: Calibration | null = null;

  private started = false;
  private startMs = 0;
  private lastMs = 0;
  private stepStartMs = 0;
  private holdMs = 0;
  private handedness: Side | null = null;
  private candidate = 0; // 0 none, 1 left, 2 right

  // Hold-still accumulators. Position stats reset when the position breaks; arm stats when the
  // arms-out pose breaks; the run timer when either does.
  private posN = 0;
  private sumSw = 0;
  private sumMx = 0;
  private sumMy = 0;
  private sumHy = 0;
  private sumArm = 0;
  private armN = 0;
  private runMs = 0;

  constructor(
    stance: Stance,
    options: {
      seated?: boolean;
      config?: CalibrationConfig;
      defaultHandedness?: Side;
      /** False skips the "raise your dominant hand" step (default true). */
      usesHandedness?: boolean;
    } = {},
  ) {
    this.seated = options.seated === true;
    this.usesHandedness = options.usesHandedness !== false;
    this.config = options.config ?? calibrationConfig;
    this.defaultHandedness = options.defaultHandedness ?? 'right';
    this.kind = stance === 'full-body' && this.seated ? 'upper-body' : stance;
    this.reset();
  }

  get done(): boolean {
    return this.finished;
  }

  result(): Calibration | null {
    return this.calibration;
  }

  setBrightness(luma: number | null): void {
    this.brightness = luma;
  }

  reset(): void {
    this.finished = false;
    this.calibration = null;
    this.started = false;
    this.startMs = 0;
    this.lastMs = 0;
    this.handedness = null;
    this.clearMeasurement();
    this.enterStep('position', 0);
    const v = this.view;
    v.problem = 'none';
    v.handedness = null;
    v.ok = false;
    v.message = this.positionMessage();
    v.hint = null;
    v.progress = 0;
  }

  update(state: InputState, nowMs: number): CalibrationView {
    const v = this.view;
    if (this.finished) return v;
    let dt = 0;
    if (!this.started) {
      this.started = true;
      this.startMs = nowMs;
      this.stepStartMs = nowMs;
    } else {
      dt = Math.min(MAX_DT_MS, Math.max(0, nowMs - this.lastMs));
    }
    this.lastMs = nowMs;
    v.problem = state.problem;

    if (nowMs - this.startMs >= this.config.timeoutMs) {
      this.finish(state);
      return v;
    }

    if (!state.tracking) {
      this.pause();
      return v;
    }

    // A step that completes hands over to the next within the same frame, so progress is never idle.
    for (let guard = 0; guard < 5 && !this.finished; guard++) {
      const before = v.step;
      switch (v.step) {
        case 'position':
          this.stepPosition(state, dt);
          break;
        case 'lighting':
          this.stepLighting(nowMs);
          break;
        case 'handedness':
          this.stepHandedness(state, dt);
          break;
        default:
          this.stepHold(state, dt, nowMs);
          break;
      }
      if (v.step === before) break;
      dt = 0;
    }
    return v;
  }

  skip(state: InputState): Calibration {
    return this.calibration ?? this.finish(state);
  }

  // ---- steps ----

  private stepPosition(state: InputState, dt: number): void {
    const v = this.view;
    const ok = this.positionOk(state);
    v.message = this.positionMessage();
    v.hint = this.positionHint(state);
    v.ok = ok;
    if (ok) this.holdMs += dt;
    else this.holdMs = 0;
    v.progress = Math.min(1, this.holdMs / this.config.positionHoldMs);
    if (this.holdMs >= this.config.positionHoldMs) this.enterStep('lighting', this.lastMs);
  }

  private stepLighting(nowMs: number): void {
    const v = this.view;
    const b = this.brightness;
    const dark = b !== null && b < this.config.lightingWarnBelow;
    const waited = nowMs - this.stepStartMs;
    if (!dark || waited >= this.config.lightingMaxWaitMs) {
      const skipHand = this.kind === 'hands-close' || !this.usesHandedness;
      this.enterStep(skipHand ? 'hold-still' : 'handedness', nowMs);
      if (skipHand) {
        this.handedness = this.defaultHandedness;
        v.handedness = this.handedness;
      }
      return;
    }
    v.message = MSG_LIGHTING;
    v.hint = HINT_DARK;
    v.ok = false;
    v.progress = Math.min(1, waited / this.config.lightingMaxWaitMs);
  }

  private stepHandedness(state: InputState, dt: number): void {
    const v = this.view;
    v.message = MSG_HANDEDNESS;
    v.hint = null;
    const above = this.config.raiseAbove;
    const l = state.hasPose && state.arms.left.wristY > above;
    const r = state.hasPose && state.arms.right.wristY > above;
    const c = l === r ? 0 : l ? 1 : 2;
    v.ok = c !== 0;
    if (c === 0 || c !== this.candidate) this.holdMs = 0;
    this.candidate = c;
    if (c !== 0) this.holdMs += dt;
    v.progress = Math.min(1, this.holdMs / this.config.handednessHoldMs);
    if (c !== 0 && this.holdMs >= this.config.handednessHoldMs) {
      this.handedness = c === 1 ? 'left' : 'right';
      v.handedness = this.handedness;
      this.enterStep('hold-still', this.lastMs);
    }
  }

  private stepHold(state: InputState, dt: number, nowMs: number): void {
    const v = this.view;
    const hands = this.kind === 'hands-close';
    v.message = hands ? MSG_HOLD_HANDS : MSG_HOLD_POSE;
    v.hint = hands ? null : this.positionHint(state);
    const posOk = this.positionOk(state);
    if (!posOk) this.resetSums();
    let still = false;
    if (posOk) {
      if (hands) {
        const hl = state.hands.left;
        const hr = state.hands.right;
        still =
          Math.hypot(hl.vx, hl.vy) < HANDS_STILL_SPEED &&
          Math.hypot(hr.vx, hr.vy) < HANDS_STILL_SPEED;
        if (still) {
          this.addPosition(state);
        } else {
          this.resetSums();
        }
      } else {
        this.addPosition(state);
        const al = state.arms.left;
        const ar = state.arms.right;
        const p = state.pose;
        still =
          p[PoseIndex.LEFT_WRIST * POSE_STRIDE + 3] >= MIN_VISIBILITY &&
          p[PoseIndex.RIGHT_WRIST * POSE_STRIDE + 3] >= MIN_VISIBILITY &&
          Math.abs(al.wristY) < ARMS_OUT_MAX_ABS_Y &&
          Math.abs(ar.wristY) < ARMS_OUT_MAX_ABS_Y &&
          Math.abs(al.wristX) > ARMS_OUT_MIN_ABS_X &&
          Math.abs(ar.wristX) > ARMS_OUT_MIN_ABS_X;
        if (still) {
          this.sumArm += (Math.hypot(al.wristX, al.wristY) + Math.hypot(ar.wristX, ar.wristY)) / 2;
          this.armN++;
        } else {
          this.sumArm = 0;
          this.armN = 0;
        }
      }
    }
    v.ok = posOk && still;
    if (v.ok) this.runMs += dt;
    else this.runMs = 0;
    v.progress = Math.min(1, this.runMs / this.config.measureMs);

    if (this.runMs >= this.config.measureMs) {
      this.finish(state);
    } else if (!hands && nowMs - this.stepStartMs >= ARMS_OUT_GIVE_UP_MS) {
      this.armN = 0; // use the default arm length
      this.finish(state);
    }
  }

  private pause(): void {
    const v = this.view;
    v.message = MSG_LOST;
    v.hint = null;
    v.ok = false;
    if (v.step === 'position') {
      this.holdMs = 0;
      v.progress = 0;
    }
    if (v.step === 'hold-still') {
      this.resetSums();
      this.runMs = 0;
      v.progress = 0;
    }
    if (v.step === 'handedness') {
      this.candidate = 0;
      this.holdMs = 0;
      v.progress = 0;
    }
  }

  // ---- requirement and measurement helpers ----

  private lmOk(pose: Float32Array, index: number): boolean {
    const o = index * POSE_STRIDE;
    const m = this.config.margin;
    const x = pose[o];
    const y = pose[o + 1];
    return pose[o + 3] >= MIN_VISIBILITY && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
  }

  private positionOk(state: InputState): boolean {
    if (this.kind === 'hands-close') return state.hands.left.present && state.hands.right.present;
    if (!state.hasPose) return false;
    const p = state.pose;
    const sw = state.shoulderWidth;
    if (!this.lmOk(p, PoseIndex.LEFT_SHOULDER) || !this.lmOk(p, PoseIndex.RIGHT_SHOULDER)) {
      return false;
    }
    if (this.kind === 'full-body') {
      if (sw < this.config.minShoulderWidth || sw > this.config.maxShoulderWidth) return false;
      return (
        this.lmOk(p, PoseIndex.LEFT_HIP) &&
        this.lmOk(p, PoseIndex.RIGHT_HIP) &&
        this.lmOk(p, PoseIndex.LEFT_KNEE) &&
        this.lmOk(p, PoseIndex.RIGHT_KNEE) &&
        this.lmOk(p, PoseIndex.LEFT_ANKLE) &&
        this.lmOk(p, PoseIndex.RIGHT_ANKLE)
      );
    }
    if (sw < this.config.minShoulderWidth || sw > UPPER_BODY_MAX_SHOULDER_WIDTH) return false;
    const wrists = this.lmOk(p, PoseIndex.LEFT_WRIST) && this.lmOk(p, PoseIndex.RIGHT_WRIST);
    const elbows = this.lmOk(p, PoseIndex.LEFT_ELBOW) && this.lmOk(p, PoseIndex.RIGHT_ELBOW);
    return wrists || elbows;
  }

  private positionMessage(): string {
    if (this.kind === 'full-body') return MSG_POSITION_FULL;
    if (this.kind === 'upper-body') return MSG_POSITION_UPPER;
    return MSG_POSITION_HANDS;
  }

  private positionHint(state: InputState): string | null {
    if (this.kind === 'hands-close' || !state.hasPose) return null;
    if (state.problem === 'move-left') return HINT_LEFT;
    if (state.problem === 'move-right') return HINT_RIGHT;
    const sw = state.shoulderWidth;
    const max =
      this.kind === 'full-body' ? this.config.maxShoulderWidth : UPPER_BODY_MAX_SHOULDER_WIDTH;
    if (sw > max || state.problem === 'step-back') return HINT_STEP_BACK;
    if ((sw > 0 && sw < this.config.minShoulderWidth) || state.problem === 'step-closer') {
      return HINT_CLOSER;
    }
    return null;
  }

  private addPosition(state: InputState): void {
    this.posN++;
    if (this.kind === 'hands-close') {
      this.sumMx += (state.hands.left.x + state.hands.right.x) / 2;
      this.sumMy += (state.hands.left.y + state.hands.right.y) / 2;
      return;
    }
    const p = state.pose;
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    const my = (p[ls + 1] + p[rs + 1]) / 2;
    this.sumSw += state.shoulderWidth;
    this.sumMx += (p[ls] + p[rs]) / 2;
    this.sumMy += my;
    const lh = PoseIndex.LEFT_HIP * POSE_STRIDE;
    const rh = PoseIndex.RIGHT_HIP * POSE_STRIDE;
    if (p[lh + 3] >= MIN_VISIBILITY && p[rh + 3] >= MIN_VISIBILITY) {
      this.sumHy += (p[lh + 1] + p[rh + 1]) / 2;
    } else {
      this.sumHy += my + TORSO_SW * state.shoulderWidth;
    }
  }

  private resetSums(): void {
    this.posN = 0;
    this.sumSw = 0;
    this.sumMx = 0;
    this.sumMy = 0;
    this.sumHy = 0;
    this.sumArm = 0;
    this.armN = 0;
    this.runMs = 0;
  }

  private clearMeasurement(): void {
    this.resetSums();
    this.holdMs = 0;
    this.candidate = 0;
  }

  private enterStep(step: CalibrationView['step'], nowMs: number): void {
    const v = this.view;
    v.step = step;
    v.progress = 0;
    v.ok = false;
    this.stepStartMs = nowMs;
    this.holdMs = 0;
    this.candidate = 0;
    if (step === 'hold-still') this.resetSums();
  }

  /** Build the result from whatever has been measured plus defaults, and mark done. */
  private finish(state: InputState): Calibration {
    const handedness = this.handedness ?? this.defaultHandedness;
    const cal = defaultCalibration(this.kind, handedness);
    cal.seated = this.seated;
    if (this.posN > 0) {
      const n = this.posN;
      cal.centreX = this.sumMx / n;
      cal.centreY = this.sumMy / n;
      if (this.kind === 'hands-close') {
        cal.hipY = cal.centreY;
      } else {
        cal.shoulderWidth = this.sumSw / n;
        cal.hipY = this.sumHy / n;
        if (this.armN > 0) cal.armLength = this.sumArm / this.armN;
      }
    } else {
      this.fromCurrent(state, cal);
    }
    this.calibration = cal;
    this.finished = true;
    const v = this.view;
    v.step = 'done';
    v.message = MSG_DONE;
    v.hint = null;
    v.progress = 1;
    v.ok = true;
    v.handedness = handedness;
    return cal;
  }

  /** Nothing was averaged: take a one-frame snapshot if the player is tracked right now. */
  private fromCurrent(state: InputState, cal: Calibration): void {
    if (!state.tracking) return;
    if (this.kind === 'hands-close') {
      if (state.hands.left.present && state.hands.right.present) {
        cal.centreX = (state.hands.left.x + state.hands.right.x) / 2;
        cal.centreY = (state.hands.left.y + state.hands.right.y) / 2;
        cal.hipY = cal.centreY;
      }
      return;
    }
    if (!state.hasPose || !(state.shoulderWidth > 0)) return;
    const p = state.pose;
    const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
    const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
    if (p[ls + 3] < MIN_VISIBILITY || p[rs + 3] < MIN_VISIBILITY) return;
    cal.shoulderWidth = state.shoulderWidth;
    cal.centreX = (p[ls] + p[rs]) / 2;
    cal.centreY = (p[ls + 1] + p[rs + 1]) / 2;
    const lh = PoseIndex.LEFT_HIP * POSE_STRIDE;
    const rh = PoseIndex.RIGHT_HIP * POSE_STRIDE;
    cal.hipY =
      p[lh + 3] >= MIN_VISIBILITY && p[rh + 3] >= MIN_VISIBILITY
        ? (p[lh + 1] + p[rh + 1]) / 2
        : cal.centreY + TORSO_SW * cal.shoulderWidth;
  }
}
