import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import type { InputState, Side } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';
import { visible } from './util';

const MAX_HISTORY = 16;
/** Per-frame blend toward a larger hip-to-knee drop (the standing baseline grows quickly). */
const BASELINE_ATTACK = 0.3;
/** Time constant (s) of the baseline shrinking toward a smaller drop (slow). */
const BASELINE_TAU_S = 5;
/** A lift on one side only counts when the other knee is below this fraction of it. */
const SYMMETRY = 0.6;
/** A new step must rise above the last valley by this fraction of `minLift`. */
const RISE_FRACTION = 0.5;

const SIDES: readonly Side[] = ['left', 'right'];
const HIPS = [PoseIndex.LEFT_HIP, PoseIndex.RIGHT_HIP];
const KNEES = [PoseIndex.LEFT_KNEE, PoseIndex.RIGHT_KNEE];

/**
 * Running in place. Knee lift = how far the knee has risen above its standing position relative
 * to the hip (sw). A step is a lift above `minLift` that falls back below half its peak; the Step
 * event is stamped at the lift peak. Writes `state.cadence` in place.
 */
export class CadenceRecognizer implements Recognizer {
  readonly name = 'cadence';
  private readonly config: RecognizerConfig;
  private readonly baseline = new Float64Array(2);
  private readonly hasBaseline = [false, false];
  private readonly lift = new Float64Array(2);
  private readonly valid = [false, false];
  private readonly active = [false, false];
  /** Lowest lift seen since the last step ended; a new step must rise clearly above it. */
  private readonly valley = new Float64Array(2);
  private readonly peak = new Float64Array(2);
  private readonly peakT = new Float64Array(2);
  private readonly otherAtPeak = new Float64Array(2);
  /** Lift one frame before and after the peak sample, and the frame spacing, for refining the peak time. */
  private readonly peakPrev = new Float64Array(2);
  private readonly peakNext = new Float64Array(2);
  private readonly peakDt = new Float64Array(2);
  private readonly prevLift = new Float64Array(2);
  private prevT = Number.NaN;
  private lastStepT = Number.NEGATIVE_INFINITY;
  private lastT = Number.NaN;
  /** Ring of the most recent step intervals (ms) and amplitudes. */
  private readonly intervals = new Float64Array(MAX_HISTORY);
  private readonly amplitudes = new Float64Array(MAX_HISTORY);
  private historyCount = 0;
  private historyHead = 0;

  constructor(config: RecognizerConfig = recognizerConfig) {
    this.config = config;
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.cadence;
    const p = state.pose;
    const sw = state.shoulderWidth;
    const dtS = Number.isFinite(this.lastT) ? Math.max(0, state.t - this.lastT) / 1000 : 0;
    this.lastT = state.t;

    for (let i = 0; i < 2; i++) {
      const ok = sw > 0 && visible(p, HIPS[i]) && visible(p, KNEES[i]);
      this.valid[i] = ok;
      if (!ok) {
        this.lift[i] = 0;
        this.active[i] = false;
        continue;
      }
      const drop = (p[KNEES[i] * POSE_STRIDE + 1] - p[HIPS[i] * POSE_STRIDE + 1]) / sw;
      if (!this.hasBaseline[i]) {
        this.baseline[i] = drop;
        this.hasBaseline[i] = true;
      } else if (drop > this.baseline[i]) {
        this.baseline[i] += (drop - this.baseline[i]) * BASELINE_ATTACK;
      } else if (this.baseline[i] - drop < c.minLift * 0.5) {
        this.baseline[i] -= (this.baseline[i] - drop) * Math.min(1, dtS / BASELINE_TAU_S);
      }
      this.lift[i] = Math.max(0, this.baseline[i] - drop);
    }

    const frameDt = Number.isFinite(this.prevT) ? state.t - this.prevT : 0;
    for (let i = 0; i < 2; i++) {
      if (!this.valid[i]) continue;
      const lift = this.lift[i];
      if (!this.active[i]) {
        if (lift < this.valley[i]) this.valley[i] = lift;
        if (lift > c.minLift && lift - this.valley[i] > c.minLift * RISE_FRACTION) {
          this.active[i] = true;
          this.peak[i] = lift;
          this.peakT[i] = state.t;
          this.otherAtPeak[i] = this.lift[1 - i];
          this.peakPrev[i] = this.prevLift[i];
          this.peakNext[i] = Number.NaN;
          this.peakDt[i] = frameDt;
        }
        continue;
      }
      if (lift > this.peak[i]) {
        this.peak[i] = lift;
        this.peakT[i] = state.t;
        this.otherAtPeak[i] = this.lift[1 - i];
        this.peakPrev[i] = this.prevLift[i];
        this.peakNext[i] = Number.NaN;
        this.peakDt[i] = frameDt;
      } else if (Number.isNaN(this.peakNext[i])) {
        this.peakNext[i] = lift;
        if (lift < this.peak[i] * 0.5) this.endStep(i, emit);
      } else if (lift < this.peak[i] * 0.5) {
        this.endStep(i, emit);
      }
    }
    for (let i = 0; i < 2; i++) this.prevLift[i] = this.lift[i];
    this.prevT = state.t;

    this.updateCadence(state);
  }

  private endStep(i: number, emit: Emit): void {
    this.active[i] = false;
    this.valley[i] = this.lift[i];
    this.finishStep(i, emit);
  }

  /** Peak time of lift `i`, refined below frame resolution by a parabola through three samples. */
  private refinedPeakT(i: number): number {
    const a = this.peakPrev[i];
    const b = this.peak[i];
    const c = this.peakNext[i];
    const dt = this.peakDt[i];
    if (Number.isNaN(c) || !(dt > 0)) return this.peakT[i];
    const denom = a - 2 * b + c;
    if (!(denom < -1e-9)) return this.peakT[i];
    const offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
    return this.peakT[i] + offset * dt;
  }

  private finishStep(i: number, emit: Emit): void {
    const c = this.config.cadence;
    const t = this.refinedPeakT(i);
    const amp = this.peak[i];
    if (this.otherAtPeak[i] > amp * SYMMETRY) return; // both knees up: squat or jump, not a step
    const interval = t - this.lastStepT;
    if (interval < c.minStepMs) return;
    if (interval <= c.maxStepMs) {
      this.intervals[this.historyHead] = interval;
      this.amplitudes[this.historyHead] = amp;
      this.historyHead = (this.historyHead + 1) % MAX_HISTORY;
      if (this.historyCount < MAX_HISTORY) this.historyCount++;
    } else {
      // A long pause: start the average afresh.
      this.historyCount = 0;
      this.historyHead = 0;
      this.intervals[0] = 0;
    }
    this.lastStepT = t;
    emit({ type: 'Step', t, side: SIDES[i], amplitude: amp });
  }

  private updateCadence(state: InputState): void {
    const c = this.config.cadence;
    const cad = state.cadence;
    const n = Math.min(this.historyCount, Math.max(1, Math.floor(c.smoothing)), MAX_HISTORY);
    if (n < 1 || this.historyCount < 1) {
      cad.stepsPerSecond = 0;
      cad.amplitude = 0;
      return;
    }
    let sumI = 0;
    let sumA = 0;
    for (let k = 1; k <= n; k++) {
      const idx = (this.historyHead - k + MAX_HISTORY) % MAX_HISTORY;
      sumI += this.intervals[idx];
      sumA += this.amplitudes[idx];
    }
    const meanInterval = sumI / n;
    if (!(meanInterval > 0)) {
      cad.stepsPerSecond = 0;
      cad.amplitude = 0;
      return;
    }
    const since = state.t - this.lastStepT;
    // A step is only detected a little after its peak, so allow for that before decaying.
    const fullUntil = Math.min(meanInterval * 1.6, c.decayMs * 0.75);
    let factor = 1;
    if (since > fullUntil) factor = Math.max(0, 1 - (since - fullUntil) / (c.decayMs - fullUntil));
    const rate = Math.min(c.softCap, 1000 / meanInterval) * factor;
    cad.stepsPerSecond = rate;
    cad.amplitude = rate > 0 ? sumA / n : 0;
  }

  reset(): void {
    this.hasBaseline[0] = this.hasBaseline[1] = false;
    this.active[0] = this.active[1] = false;
    this.valley[0] = this.valley[1] = 0;
    this.lift[0] = this.lift[1] = 0;
    this.lastStepT = Number.NEGATIVE_INFINITY;
    this.lastT = Number.NaN;
    this.prevT = Number.NaN;
    this.prevLift[0] = this.prevLift[1] = 0;
    this.historyCount = 0;
    this.historyHead = 0;
  }
}
