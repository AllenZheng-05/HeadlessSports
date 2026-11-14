import { CONTROL_KEYS, defaultControls } from './controls';
import type { BodyControls } from './controls';

export type Ease = 'linear' | 'smooth' | 'in' | 'out';

/** One segment of motion. Controls named in `to` move from their value at the start of the step to the target over `dur`. */
export interface ScriptStep {
  /** ms, > 0 */
  dur: number;
  to?: Partial<BodyControls>;
  /** Default 'smooth'. */
  ease?: Ease;
  label?: string;
}

export interface Script {
  name: string;
  /** Overrides applied to `defaultControls()` for time zero. */
  start?: Partial<BodyControls>;
  steps: ScriptStep[];
  loop?: boolean;
}

export function applyEase(ease: Ease, p: number): number {
  switch (ease) {
    case 'linear':
      return p;
    case 'in':
      return p * p;
    case 'out':
      return 1 - (1 - p) * (1 - p);
    default:
      return p * p * (3 - 2 * p);
  }
}

const K = CONTROL_KEYS.length;

export class ScriptPlayer {
  readonly durationMs: number;
  private readonly loop: boolean;
  private readonly count: number;
  /** Step i spans [starts[i], ends[i]). */
  private readonly starts: Float64Array;
  private readonly ends: Float64Array;
  private readonly from: Float64Array;
  private readonly to: Float64Array;
  private readonly eases: Ease[];
  private readonly labels: string[];

  constructor(script: Script) {
    const steps = script.steps;
    this.count = steps.length;
    this.loop = script.loop === true;
    this.starts = new Float64Array(this.count);
    this.ends = new Float64Array(this.count);
    this.from = new Float64Array(this.count * K);
    this.to = new Float64Array(this.count * K);
    this.eases = [];
    this.labels = [];

    const cur = defaultControls();
    if (script.start) Object.assign(cur, script.start);
    const curArr = new Float64Array(K);
    for (let k = 0; k < K; k++) curArr[k] = cur[CONTROL_KEYS[k]];

    let t = 0;
    for (let i = 0; i < this.count; i++) {
      const step = steps[i];
      if (!(step.dur > 0)) throw new Error(`Script "${script.name}" step ${i} has dur <= 0`);
      this.starts[i] = t;
      t += step.dur;
      this.ends[i] = t;
      this.eases.push(step.ease ?? 'smooth');
      this.labels.push(step.label ?? '');
      for (let k = 0; k < K; k++) {
        this.from[i * K + k] = curArr[k];
        const target = step.to?.[CONTROL_KEYS[k]];
        if (target !== undefined) curArr[k] = target;
        this.to[i * K + k] = curArr[k];
      }
    }
    this.durationMs = t;
    this.initial = Float64Array.from(this.count > 0 ? this.from.subarray(0, K) : curArr);
  }

  private readonly initial: Float64Array;

  /** Script time folded into [0, duration] (wrapped when looping). */
  private fold(tMs: number): number {
    const d = this.durationMs;
    if (this.loop && d > 0) {
      const m = tMs % d;
      return m < 0 ? m + d : m;
    }
    return tMs < 0 ? 0 : tMs > d ? d : tMs;
  }

  /** Index of the step containing tt, found by binary search. Requires 0 <= tt < duration. */
  private indexAt(tt: number): number {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ends[mid] > tt) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Evaluate the controls at script time tMs into `out`. Clamps at the end (or wraps when loop). No allocation. */
  sample(tMs: number, out: BodyControls): void {
    if (this.count === 0) {
      for (let k = 0; k < K; k++) out[CONTROL_KEYS[k]] = this.initial[k];
      return;
    }
    const tt = this.fold(tMs);
    if (tt >= this.durationMs) {
      const base = (this.count - 1) * K;
      for (let k = 0; k < K; k++) out[CONTROL_KEYS[k]] = this.to[base + k];
      return;
    }
    const i = this.indexAt(tt);
    const p = (tt - this.starts[i]) / (this.ends[i] - this.starts[i]);
    const e = applyEase(this.eases[i], p);
    const base = i * K;
    for (let k = 0; k < K; k++) {
      const a = this.from[base + k];
      out[CONTROL_KEYS[k]] = a + (this.to[base + k] - a) * e;
    }
  }

  /** Label of the step active at tMs, or ''. */
  labelAt(tMs: number): string {
    if (this.count === 0) return '';
    if (!this.loop && (tMs < 0 || tMs >= this.durationMs)) return '';
    return this.labels[this.indexAt(this.fold(tMs) % this.durationMs)];
  }
}
