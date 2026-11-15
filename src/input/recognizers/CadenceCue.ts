import type { CadenceCueConfig, RecognizerConfig } from './config';

type CadenceConfig = RecognizerConfig['cadence'];

/** Most recent steps kept per cue. */
export const CUE_RING = 8;
/** Intervals used for the rate estimate. */
const RATE_INTERVALS = 6;
/** A gap between frames longer than this restarts the filters (ms). */
const MAX_GAP_MS = 250;
/** Recent filtered samples kept for timing a peak. */
const RING = 32;

/**
 * One running cue: a scalar signal that rises and falls once per step (torso bob) or alternates
 * sign from step to step (an antiphase left-minus-right signal; both its maxima and minima are
 * steps). `push` filters the signal (high-pass, then low-pass) and finds its extremes with a
 * zigzag detector: a peak is confirmed once the signal has retraced `threshold` from it, and only
 * counts when the swing from the previous extreme is at least `minSwing`. Accepted peaks form a
 * streak; `evaluate` turns the streak into a step rate and a confidence.
 *
 * No allocation after construction.
 */
export class CadenceCue {
  /** Set by `evaluate`. */
  active = false;
  /** Steps per second from the median interval. */
  rate = 0;
  /** 0..1: how sure the cue is that this is running (streak length, regularity, swing). */
  conf = 0;
  /** Median peak-to-peak swing of the streak, sw. */
  swing = 0;

  private hasBase = false;
  private base = 0;
  private lp = 0;
  private prevLp = 0;
  private lastSampleT = 0;
  private readonly ringT = new Float64Array(RING);
  private readonly ringV = new Float64Array(RING);
  private ringHead = 0;
  private mode = 0;

  /** 0 unknown, 1 seeking a maximum, -1 seeking a minimum. */
  private dir = 0;
  private hi = 0;
  private hiT = 0;
  private lo = 0;
  private loT = 0;
  /** In the signed space (dir * lp). */
  private extX = 0;
  private extT = 0;
  private lastExt = 0;

  private readonly times = new Float64Array(CUE_RING);
  private readonly swings = new Float64Array(CUE_RING);
  private readonly signs = new Int8Array(CUE_RING);
  private head = 0;
  private streakCount = 0;
  private readonly scratch = new Float64Array(CUE_RING);

  constructor(
    /** Only maxima are steps (a bob signal); false: maxima and minima both are. */
    private readonly maximaOnly: boolean,
  ) {}

  /** Number of steps in the current streak (at most CUE_RING). */
  get streak(): number {
    return this.streakCount;
  }

  /** Time of the k-th most recent step of the streak (0 is the newest). */
  peakTime(k: number): number {
    return this.times[(this.head - 1 - k + 2 * CUE_RING) % CUE_RING];
  }

  /** Sign (+1 maximum, -1 minimum) of the k-th most recent step. */
  peakSign(k: number): number {
    return this.signs[(this.head - 1 - k + 2 * CUE_RING) % CUE_RING];
  }

  /**
   * Fold in one sample of the raw signal. `mode` names where the signal came from (which sides were
   * visible): a change restarts the filters because the signal's offset jumps. Returns true when
   * this frame confirmed a step; its time, swing and sign are then `peakTime(0)` and so on.
   */
  push(t: number, raw: number, mode: number, cue: CadenceCueConfig, c: CadenceConfig): boolean {
    const dt = t - this.lastSampleT;
    if (!this.hasBase || mode !== this.mode || dt <= 0 || dt > MAX_GAP_MS) {
      this.hasBase = true;
      this.mode = mode;
      this.base = raw;
      this.lp = 0;
      this.prevLp = 0;
      this.lastSampleT = t;
      this.ringHead = 0;
      this.ringT.fill(Number.NEGATIVE_INFINITY);
      this.dir = 0;
      this.hi = this.lo = 0;
      this.hiT = this.loT = t;
      return false;
    }
    this.lastSampleT = t;
    this.base += (raw - this.base) * (1 - Math.exp(-dt / c.highpassMs));
    const v = raw - this.base;
    this.prevLp = this.lp;
    this.lp += (v - this.lp) * (1 - Math.exp(-dt / c.lowpassMs));
    this.ringT[this.ringHead] = t;
    this.ringV[this.ringHead] = this.lp;
    this.ringHead = (this.ringHead + 1) % RING;
    return this.zigzag(t, dt, cue, c);
  }

  /** The signal is not available this frame: the filters start over when it returns. */
  suspend(): void {
    this.hasBase = false;
    this.dir = 0;
  }

  /** Drop the streak as well (a throw, a punch: not a pump). */
  blank(): void {
    this.suspend();
    this.streakCount = 0;
    this.active = false;
    this.conf = 0;
  }

  reset(): void {
    this.blank();
    this.head = 0;
    this.rate = 0;
    this.swing = 0;
  }

  private zigzag(t: number, dt: number, cue: CadenceCueConfig, c: CadenceConfig): boolean {
    const lp = this.lp;
    const theta = cue.threshold;
    if (this.dir === 0) {
      if (lp > this.hi) {
        this.hi = lp;
        this.hiT = t;
      }
      if (lp < this.lo) {
        this.lo = lp;
        this.loT = t;
      }
      if (this.hi - this.lo >= theta) {
        if (this.hiT >= this.loT) {
          // Rose from a low: the high is still open.
          this.dir = 1;
          this.lastExt = this.lo;
          this.extX = this.hi;
          this.extT = this.hiT;
        } else {
          this.dir = -1;
          this.lastExt = this.hi;
          this.extX = -this.lo;
          this.extT = this.loT;
        }
      }
      return false;
    }
    const dir = this.dir;
    const x = dir * lp;
    if (x >= this.extX) {
      this.extX = x;
      this.extT = t;
      return false;
    }
    if (this.extX - x < theta) return false;

    // Confirmed: the extreme was `extX` at `extT`.
    const extLp = dir * this.extX;
    const swing = Math.abs(extLp - this.lastExt);
    let accepted = false;
    // The first step of a streak is measured from rest, so it only shows half a swing.
    const need = this.streakCount === 0 ? 0.5 * cue.minSwing : cue.minSwing;
    if ((dir > 0 || !this.maximaOnly) && swing >= need) {
      accepted = this.record(this.peakTimeMid(t, dt, theta), swing, dir, c);
    }
    this.lastExt = extLp;
    this.dir = -dir;
    this.extX = -dir * lp;
    this.extT = t;
    return accepted;
  }

  /**
   * Time of the open extreme: the midpoint of the moments the signal crossed `theta` below the
   * peak on the way up and on the way down. The flat top of a noisy peak is a poor place to read a
   * time from; the flanks are steep.
   */
  private peakTimeMid(t: number, dt: number, theta: number): number {
    const dir = this.dir;
    const level = this.extX - theta;
    // Down-crossing, between the previous sample and this one.
    const xNow = dir * this.lp;
    const xPrev = dir * this.prevLp;
    const span = xPrev - xNow;
    const tDown = span > 1e-12 ? t - dt + (dt * (xPrev - level)) / span : t;
    // Up-crossing: walk back through the recent samples.
    let tUp = Number.NaN;
    let nextT = t - dt;
    let nextX = xPrev;
    for (let k = 2; k < RING; k++) {
      const i = (this.ringHead - 1 - k + 2 * RING) % RING;
      const x = dir * this.ringV[i];
      const ti = this.ringT[i];
      if (!(ti < nextT)) break;
      if (x < level) {
        const rise = nextX - x;
        tUp = rise > 1e-12 ? ti + ((nextT - ti) * (level - x)) / rise : ti;
        break;
      }
      nextT = ti;
      nextX = x;
    }
    if (Number.isNaN(tUp)) return this.extT;
    const mid = 0.5 * (tUp + tDown);
    return mid < tUp ? tUp : mid > tDown ? tDown : mid;
  }

  private record(t: number, swing: number, sign: number, c: CadenceConfig): boolean {
    if (this.streakCount > 0) {
      const last = this.peakTime(0);
      const iv = t - last;
      if (iv < c.minStepMs) return false;
      if (iv > c.maxStepMs) {
        this.streakCount = 0;
      } else if (this.streakCount >= 2) {
        const prev = last - this.peakTime(1);
        if (iv > prev * c.maxIntervalRatio || iv * c.maxIntervalRatio < prev) this.streakCount = 0;
      }
    }
    this.times[this.head] = t;
    this.swings[this.head] = swing;
    this.signs[this.head] = sign;
    this.head = (this.head + 1) % CUE_RING;
    if (this.streakCount < CUE_RING) this.streakCount++;
    return true;
  }

  /** Median of the first `n` scratch values (insertion sort; n is tiny). */
  private median(n: number): number {
    const s = this.scratch;
    for (let i = 1; i < n; i++) {
      const v = s[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) {
        s[j + 1] = s[j];
        j--;
      }
      s[j + 1] = v;
    }
    return n % 2 === 1 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  }

  /** Update `active`, `rate`, `conf` and `swing` for time `now`. */
  evaluate(now: number, cue: CadenceCueConfig, c: CadenceConfig): void {
    this.active = false;
    this.conf = 0;
    this.rate = 0;
    this.swing = 0;
    const streak = this.streakCount;
    if (streak < 2) return;
    const nIv = Math.min(streak - 1, RATE_INTERVALS);
    const s = this.scratch;
    for (let k = 0; k < nIv; k++) s[k] = this.peakTime(k) - this.peakTime(k + 1);
    const med = this.median(nIv);
    if (!(med > 0)) return;
    if (now - this.peakTime(0) > c.staleFactor * med + c.staleSlackMs) {
      this.streakCount = 0;
      return;
    }
    // Spread of the intervals (scratch is sorted, so recompute from the ring).
    let dev = 0;
    for (let k = 0; k < nIv; k++) dev += Math.abs(this.peakTime(k) - this.peakTime(k + 1) - med);
    const spread = dev / nIv / med / c.maxSpread;
    const regularity = Math.max(0, 1 - spread * spread);
    if (regularity <= 0) return;
    const nSw = Math.min(streak, RATE_INTERVALS);
    for (let k = 0; k < nSw; k++) s[k] = this.swings[(this.head - 1 - k + 2 * CUE_RING) % CUE_RING];
    const swing = this.median(nSw);
    const swingConf = Math.min(1, swing / (1.5 * cue.minSwing));
    const streakConf = streak >= 4 ? 1 : streak === 3 ? c.peakConf3 : c.peakConf2;
    this.rate = 1000 / med;
    this.swing = swing;
    this.conf = cue.weight * streakConf * regularity * swingConf;
    this.active = this.conf > 0;
  }
}
