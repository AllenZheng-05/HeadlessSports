import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { InputState } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { visible } from './util';

/** Time constant (s) of the standing-height baseline used when there is no calibration. */
const BASELINE_TAU_S = 2;
/** Far from the baseline (a squat or jump in progress) it adapts this much more slowly. */
const BASELINE_FAR_TAU_S = 30;
/** "Near" the baseline, sw. */
const BASELINE_NEAR = 0.15;
/** A jump is complete when the rise has fallen this far (sw) below its peak. */
const FALL_CONFIRM = 0.06;
/** A jump that has not come down after this long is reported anyway. */
const MAX_JUMP_MS = 1200;
/** Squats do not fire this long after a jump (the landing absorbs like a squat). */
const POST_JUMP_QUIET_MS = 600;

/**
 * Squat: the hips drop more than `depth` (sw) for `dwellMs`; once per squat, re-armed when the
 * hips come back up. Jump: the hips rise more than `height` (sw); emitted at the peak with
 * `height` = the peak rise.
 *
 * With a calibration the signal is `state.rise`. Without one `state.rise` is 0, so the recognizer
 * keeps its own slow baseline of the hip-midpoint height (a slow squat would be absorbed by it).
 */
export class SquatJumpRecognizer implements Recognizer {
  readonly name = 'squatJump';
  private readonly config: RecognizerConfig;
  private calibrated = false;
  private baseline = 0;
  private hasBaseline = false;
  private lastT = Number.NaN;

  private squatSince = -1;
  private squatFired = false;

  private jumping = false;
  private jumpStartT = 0;
  private jumpPeak = 0;
  private jumpPeakT = 0;
  private jumpCooldownUntil = Number.NEGATIVE_INFINITY;
  private jumpEndT = Number.NEGATIVE_INFINITY;

  constructor(config: RecognizerConfig = recognizerConfig) {
    this.config = config;
  }

  setCalibrated(calibrated: boolean): void {
    this.calibrated = calibrated;
    this.hasBaseline = false;
  }

  update(state: InputState, emit: Emit): void {
    const t = state.t;
    const p = state.pose;
    const dtS = Number.isFinite(this.lastT) ? Math.max(0, t - this.lastT) / 1000 : 0;
    this.lastT = t;

    let rise: number;
    if (this.calibrated) {
      rise = state.rise;
    } else {
      const sw = state.shoulderWidth;
      if (!(sw > 0) || !visible(p, PoseIndex.LEFT_HIP) || !visible(p, PoseIndex.RIGHT_HIP)) return;
      const hipY =
        (p[PoseIndex.LEFT_HIP * POSE_STRIDE + 1] + p[PoseIndex.RIGHT_HIP * POSE_STRIDE + 1]) / 2;
      if (!this.hasBaseline) {
        this.baseline = hipY;
        this.hasBaseline = true;
      }
      rise = (this.baseline - hipY) / sw;
      const tau = Math.abs(rise) < BASELINE_NEAR ? BASELINE_TAU_S : BASELINE_FAR_TAU_S;
      this.baseline += (hipY - this.baseline) * (1 - Math.exp(-dtS / tau));
    }
    this.updateJump(t, rise, emit);
    this.updateSquat(t, -rise, emit);
  }

  private updateJump(t: number, rise: number, emit: Emit): void {
    const c = this.config.jump;
    if (!this.jumping) {
      if (rise > c.height && t >= this.jumpCooldownUntil) {
        this.jumping = true;
        this.jumpStartT = t;
        this.jumpPeak = rise;
        this.jumpPeakT = t;
      }
      return;
    }
    if (rise > this.jumpPeak) {
      this.jumpPeak = rise;
      this.jumpPeakT = t;
    }
    if (rise < this.jumpPeak - FALL_CONFIRM || t - this.jumpStartT > MAX_JUMP_MS) {
      this.jumping = false;
      this.jumpCooldownUntil = t + c.cooldownMs;
      this.jumpEndT = t;
      emit({ type: 'Jump', t: this.jumpPeakT, height: this.jumpPeak });
    }
  }

  private updateSquat(t: number, drop: number, emit: Emit): void {
    const c = this.config.squat;
    if (drop < c.depth * 0.5) {
      this.squatFired = false;
      this.squatSince = -1;
      return;
    }
    const quiet = this.jumping || t < this.jumpEndT + POST_JUMP_QUIET_MS;
    if (this.squatFired || quiet) return;
    if (drop > c.depth) {
      if (this.squatSince < 0) this.squatSince = t;
      if (t - this.squatSince >= c.dwellMs) {
        this.squatFired = true;
        emit({ type: 'Squat', t, depth: drop });
      }
    } else {
      this.squatSince = -1;
    }
  }

  reset(): void {
    this.hasBaseline = false;
    this.lastT = Number.NaN;
    this.squatSince = -1;
    this.squatFired = false;
    this.jumping = false;
    this.jumpCooldownUntil = Number.NEGATIVE_INFINITY;
    this.jumpEndT = Number.NEGATIVE_INFINITY;
  }
}
