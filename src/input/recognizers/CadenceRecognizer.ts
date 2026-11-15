import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { InputState, Side } from '../types';
import { CadenceCue, CUE_RING } from './CadenceCue';
import { recognizerConfig } from './config';
import type { CadenceCueConfig, RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { visible } from './util';

/** Cue indices. */
const ARM = 0;
const THIGH = 1;
const FOOT = 2;
const BOB = 3;
const CUES = 4;

const SHOULDERS = [PoseIndex.LEFT_SHOULDER, PoseIndex.RIGHT_SHOULDER];
const ELBOWS = [PoseIndex.LEFT_ELBOW, PoseIndex.RIGHT_ELBOW];
const WRISTS = [PoseIndex.LEFT_WRIST, PoseIndex.RIGHT_WRIST];
const HIPS = [PoseIndex.LEFT_HIP, PoseIndex.RIGHT_HIP];
const KNEES = [PoseIndex.LEFT_KNEE, PoseIndex.RIGHT_KNEE];
const ANKLES = [PoseIndex.LEFT_ANKLE, PoseIndex.RIGHT_ANKLE];
const HAND_SIDES: readonly Side[] = ['left', 'right'];

/**
 * Running in place, from a front-on camera. The knees lift mostly toward the camera, so the legs
 * alone move very little in the image; the upper body moves much more. Four cues are watched, any
 * of which can carry the detection (see `CadenceCue` for the per-cue peak finding):
 *
 * - arm: wrist and elbow height relative to the shoulders, left minus right (arms swing in antiphase)
 * - thigh: knee drop below the hip and hip-to-knee projected length, left minus right (a knee
 *   coming toward the camera rises toward the hip and the thigh foreshortens)
 * - foot: ankle height relative to the hip, left minus right, only when the ankles are well seen
 * - bob: shoulder and hip midpoint height, one rise per step
 *
 * Each cue reports a rate and a confidence. Cues whose rates agree support each other; running
 * starts when their summed confidence passes `runThreshold` and ends when it falls under
 * `stopThreshold` (a cue goes stale when its next step is overdue). Depth is never used.
 *
 * `Step` events come from the most confident agreeing cue (the "leader", stamped at its peak), so
 * one cue sets the rhythm at a time. When running starts, the leader's steps so far are emitted
 * at once. Writes `state.cadence` in place. A wrist moving faster than `armBlankSpeed` (a throw)
 * switches the arm cue off, so a throw is never taken for a pump.
 */
export class CadenceRecognizer implements Recognizer {
  readonly name = 'cadence';
  /** Latest per-cue rate (steps/s), confidence and streak, for tests and the debug page. */
  readonly cueRate = new Float64Array(CUES);
  readonly cueConf = new Float64Array(CUES);
  readonly cueStreak = new Int32Array(CUES);
  private readonly config: RecognizerConfig;
  private readonly cues: readonly CadenceCue[] = [
    new CadenceCue(false),
    new CadenceCue(false),
    new CadenceCue(false),
    new CadenceCue(true),
  ];
  private readonly stepped = new Uint8Array(CUES);
  private readonly cfgs: CadenceCueConfig[] = [];
  private running = false;
  private leader = -1;
  private lastT = Number.NaN;
  private lastEmitT = Number.NEGATIVE_INFINITY;
  private lastPeakT = Number.NEGATIVE_INFINITY;
  private armOffUntil = Number.NEGATIVE_INFINITY;
  private smoothRate = 0;
  private smoothAmp = 0;
  /** Alternates for the bob cue, which has no side of its own. */
  private altSide = 0;

  constructor(config: RecognizerConfig = recognizerConfig) {
    this.config = config;
  }

  get isRunning(): boolean {
    return this.running;
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.cadence;
    const t = state.t;
    const dtMs = Number.isFinite(this.lastT) ? Math.max(0, t - this.lastT) : 0;
    this.lastT = t;
    const sw = state.shoulderWidth;
    const usable = state.hasPose && sw > 0;

    this.stepped.fill(0);
    if (usable) {
      this.pushArm(state, t, sw, c);
      this.pushThigh(state, t, sw, c);
      this.pushFoot(state, t, sw, c);
      this.pushBob(state, t, sw, c);
    } else {
      for (let i = 0; i < CUES; i++) this.cues[i].suspend();
    }

    // Evaluate the cues and find the biggest group of agreeing ones.
    const cfgs = this.cfgs;
    cfgs[ARM] = c.arm;
    cfgs[THIGH] = c.thigh;
    cfgs[FOOT] = c.foot;
    cfgs[BOB] = c.bob;
    let bestK = -1;
    let bestS = 0;
    for (let i = 0; i < CUES; i++) {
      const cue = this.cues[i];
      cue.evaluate(t, cfgs[i], c);
      this.cueRate[i] = cue.rate;
      this.cueConf[i] = cue.conf;
      this.cueStreak[i] = cue.streak;
    }
    for (let k = 0; k < CUES; k++) {
      if (!this.cues[k].active) continue;
      const rk = this.cues[k].rate;
      let s = 0;
      for (let j = 0; j < CUES; j++) {
        if (this.cues[j].active && Math.abs(this.cues[j].rate - rk) <= c.agreement * rk) {
          s += this.cues[j].conf;
        }
      }
      if (s > bestS) {
        bestS = s;
        bestK = k;
      }
    }
    const wasRunning = this.running;
    let running = bestK >= 0 && bestS >= (wasRunning ? c.stopThreshold : c.runThreshold);
    if (running && t - this.lastPeakT > c.decayMs) running = false;
    this.running = running;

    if (!running) {
      this.leader = -1;
      this.smoothRate = 0;
      this.smoothAmp = 0;
      state.cadence.stepsPerSecond = 0;
      state.cadence.amplitude = 0;
      return;
    }

    // Fuse the rate and the effort over the agreeing group; pick the leader.
    const rBest = this.cues[bestK].rate;
    let wSum = 0;
    let rateSum = 0;
    let effortSum = 0;
    let topConf = 0;
    let top = bestK;
    for (let j = 0; j < CUES; j++) {
      const cue = this.cues[j];
      if (!cue.active || Math.abs(cue.rate - rBest) > c.agreement * rBest) continue;
      wSum += cue.conf;
      rateSum += cue.conf * cue.rate;
      effortSum += cue.conf * (cue.swing / cfgs[j].nominalSwing);
      if (cue.conf > topConf) {
        topConf = cue.conf;
        top = j;
      }
    }
    const leaderKeeps =
      this.leader >= 0 &&
      this.cues[this.leader].active &&
      Math.abs(this.cues[this.leader].rate - rBest) <= c.agreement * rBest &&
      this.cues[this.leader].conf >= 0.6 * topConf;
    if (!leaderKeeps) this.leader = top;

    const rate = Math.min(c.softCap, rateSum / wSum);
    const effort = Math.min(1, effortSum / wSum);
    if (!wasRunning) {
      this.smoothRate = rate;
      this.smoothAmp = effort;
    } else {
      const a = c.rateSmoothMs > 0 ? 1 - Math.exp(-dtMs / c.rateSmoothMs) : 1;
      this.smoothRate += (rate - this.smoothRate) * a;
      this.smoothAmp += (effort - this.smoothAmp) * a;
    }
    const amplitude = this.smoothAmp * c.amplitudeScale;
    state.cadence.stepsPerSecond = this.smoothRate;
    state.cadence.amplitude = amplitude;

    const lead = this.cues[this.leader];
    if (!wasRunning) {
      // The steps so far, oldest first, so the game has an interval to work from at once.
      const n = Math.min(lead.streak, CUE_RING);
      for (let k = n - 1; k >= 0; k--) {
        this.emitStep(emit, this.leader, lead.peakTime(k), lead.peakSign(k), amplitude);
      }
    } else if (this.stepped[this.leader] === 1) {
      this.emitStep(emit, this.leader, lead.peakTime(0), lead.peakSign(0), amplitude);
    }
  }

  private emitStep(emit: Emit, cue: number, t: number, sign: number, amplitude: number): void {
    const c = this.config.cadence;
    if (t - this.lastEmitT < c.minStepMs) return;
    this.lastEmitT = t;
    let side: Side;
    if (cue === BOB) {
      this.altSide ^= 1;
      side = HAND_SIDES[this.altSide];
    } else if (cue === ARM) {
      // The arm opposite a leg swings with it: a left-arm maximum is the right leg's step.
      side = sign > 0 ? 'right' : 'left';
    } else {
      side = sign > 0 ? 'left' : 'right';
    }
    emit({ type: 'Step', t, side, amplitude });
  }

  /** Mark a frame on which `cue` confirmed a step. */
  private mark(cue: number, t: number, stepped: boolean): void {
    if (!stepped) return;
    this.stepped[cue] = 1;
    this.lastPeakT = t;
  }

  private pushArm(state: InputState, t: number, sw: number, c: RecognizerConfig['cadence']): void {
    const cue = this.cues[ARM];
    const p = state.pose;
    if (state.arms.left.speed > c.armBlankSpeed || state.arms.right.speed > c.armBlankSpeed) {
      this.armOffUntil = t + c.armBlankMs;
      cue.blank();
      return;
    }
    if (t < this.armOffUntil) {
      cue.suspend();
      return;
    }
    let sum = 0;
    let mode = 0;
    for (let i = 0; i < 2; i++) {
      if (!visible(p, WRISTS[i]) || !visible(p, SHOULDERS[i])) continue;
      const arm = i === 0 ? state.arms.left : state.arms.right;
      let a = arm.wristY;
      if (visible(p, ELBOWS[i])) {
        const elbowUp = (p[SHOULDERS[i] * POSE_STRIDE + 1] - p[ELBOWS[i] * POSE_STRIDE + 1]) / sw;
        a = (a + c.arm.elbowWeight * elbowUp) / (1 + c.arm.elbowWeight);
      }
      // Left minus right, halved: the two arms swing in antiphase.
      sum += i === 0 ? a : -a;
      mode |= 1 << i;
    }
    if (mode === 0) {
      cue.suspend();
      return;
    }
    // With one arm hidden the other's height alone, on the same scale as an arm against a still one.
    this.mark(ARM, t, cue.push(t, sum * 0.5, mode, c.arm, c));
  }

  private pushThigh(
    state: InputState,
    t: number,
    sw: number,
    c: RecognizerConfig['cadence'],
  ): void {
    const cue = this.cues[THIGH];
    const p = state.pose;
    const asp = state.aspect;
    let sum = 0;
    let mode = 0;
    for (let i = 0; i < 2; i++) {
      if (!visible(p, HIPS[i]) || !visible(p, KNEES[i])) continue;
      const dx = (p[KNEES[i] * POSE_STRIDE] - p[HIPS[i] * POSE_STRIDE]) * asp;
      const dy = p[KNEES[i] * POSE_STRIDE + 1] - p[HIPS[i] * POSE_STRIDE + 1];
      const lift =
        -(dy + c.thigh.lengthWeight * Math.hypot(dx, dy)) / (1 + c.thigh.lengthWeight) / sw;
      sum += i === 0 ? lift : -lift;
      mode |= 1 << i;
    }
    if (mode === 0) {
      cue.suspend();
      return;
    }
    this.mark(THIGH, t, cue.push(t, sum * 0.5, mode, c.thigh, c));
  }

  private pushFoot(state: InputState, t: number, sw: number, c: RecognizerConfig['cadence']): void {
    const cue = this.cues[FOOT];
    const p = state.pose;
    let sum = 0;
    let mode = 0;
    for (let i = 0; i < 2; i++) {
      if (!visible(p, HIPS[i]) || !visible(p, ANKLES[i], c.footMinVisibility)) continue;
      const up = -(p[ANKLES[i] * POSE_STRIDE + 1] - p[HIPS[i] * POSE_STRIDE + 1]) / sw;
      sum += i === 0 ? up : -up;
      mode |= 1 << i;
    }
    if (mode === 0) {
      cue.suspend();
      return;
    }
    this.mark(FOOT, t, cue.push(t, sum * 0.5, mode, c.foot, c));
  }

  private pushBob(state: InputState, t: number, sw: number, c: RecognizerConfig['cadence']): void {
    const cue = this.cues[BOB];
    const p = state.pose;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 2; i++) {
      if (visible(p, SHOULDERS[i])) {
        sum += p[SHOULDERS[i] * POSE_STRIDE + 1];
        n++;
      }
      if (visible(p, HIPS[i])) {
        sum += p[HIPS[i] * POSE_STRIDE + 1];
        n++;
      }
    }
    if (n < 4) {
      cue.suspend();
      return;
    }
    this.mark(BOB, t, cue.push(t, -sum / (n * sw), n, c.bob, c));
  }

  reset(): void {
    for (let i = 0; i < CUES; i++) this.cues[i].reset();
    this.stepped.fill(0);
    this.cueRate.fill(0);
    this.cueConf.fill(0);
    this.cueStreak.fill(0);
    this.running = false;
    this.leader = -1;
    this.lastT = Number.NaN;
    this.lastEmitT = Number.NEGATIVE_INFINITY;
    this.lastPeakT = Number.NEGATIVE_INFINITY;
    this.armOffUntil = Number.NEGATIVE_INFINITY;
    this.smoothRate = 0;
    this.smoothAmp = 0;
  }
}
