/**
 * One Euro filter (Casiez, Roussel, Vogel 2012). Adaptive low-pass: heavy smoothing when the
 * signal is slow, light smoothing when it moves fast. Time comes from the frame, in game ms.
 *
 * Parameter values used by the input layer are starting points assuming normalised image
 * coordinates (speeds of order 1 unit/s); they are tuned by playtest.
 */

const TWO_PI = Math.PI * 2;

function smoothingAlpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (TWO_PI * Math.max(cutoffHz, 1e-6));
  return 1 / (1 + tau / dtSeconds);
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private readonly dCutoff: number;
  private initialised = false;
  private prevT = 0;
  private x = 0;
  private dx = 0;

  constructor(minCutoffHz: number, beta: number, dCutoffHz = 1) {
    this.minCutoff = minCutoffHz;
    this.beta = beta;
    this.dCutoff = dCutoffHz;
  }

  setParams(minCutoffHz: number, beta: number): void {
    this.minCutoff = minCutoffHz;
    this.beta = beta;
  }

  /** tMs must come from the frame. dt <= 0 returns the previous output and never produces NaN. */
  filter(value: number, tMs: number): number {
    if (!Number.isFinite(value)) return this.x;
    if (!this.initialised) {
      this.initialised = true;
      this.prevT = tMs;
      this.x = value;
      this.dx = 0;
      return value;
    }
    const dt = (tMs - this.prevT) / 1000;
    if (!(dt > 0)) return this.x;
    this.prevT = tMs;
    const rate = (value - this.x) / dt;
    this.dx += smoothingAlpha(this.dCutoff, dt) * (rate - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += smoothingAlpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.initialised = false;
    this.x = 0;
    this.dx = 0;
  }
}

/** N independent channels sharing one clock, state in typed arrays. */
export class OneEuroBank {
  private readonly channels: number;
  private readonly minCutoff: Float64Array;
  private readonly beta: Float64Array;
  private readonly dCutoff: number;
  private readonly x: Float64Array;
  private readonly dx: Float64Array;
  private initialised = false;
  private prevT = 0;

  constructor(channels: number, minCutoffHz: number, beta: number, dCutoffHz = 1) {
    this.channels = channels;
    this.dCutoff = dCutoffHz;
    this.minCutoff = new Float64Array(channels).fill(minCutoffHz);
    this.beta = new Float64Array(channels).fill(beta);
    this.x = new Float64Array(channels);
    this.dx = new Float64Array(channels);
  }

  /** Per-channel parameters (e.g. wrists responsive, torso smooth). */
  setChannelParams(channel: number, minCutoffHz: number, beta: number): void {
    this.minCutoff[channel] = minCutoffHz;
    this.beta[channel] = beta;
  }

  /**
   * Element e, component c (c < components) is read from input[e * stride + c], filtered as
   * channel e * components + c, and written to out[e * stride + c]. Other components of `out`
   * are not touched. `input` and `out` may be the same array.
   */
  filterInto(
    input: Float32Array,
    tMs: number,
    out: Float32Array,
    stride = 1,
    components = stride,
  ): void {
    const elements = Math.floor(this.channels / components);
    const dt = (tMs - this.prevT) / 1000;
    const first = !this.initialised;
    const stalled = !first && !(dt > 0);
    const aD = first || stalled ? 0 : smoothingAlpha(this.dCutoff, dt);
    for (let e = 0; e < elements; e++) {
      for (let c = 0; c < components; c++) {
        const ch = e * components + c;
        const idx = e * stride + c;
        const v = input[idx];
        if (first) {
          this.x[ch] = Number.isFinite(v) ? v : 0;
          this.dx[ch] = 0;
        } else if (!stalled && Number.isFinite(v)) {
          const rate = (v - this.x[ch]) / dt;
          this.dx[ch] += aD * (rate - this.dx[ch]);
          const cutoff = this.minCutoff[ch] + this.beta[ch] * Math.abs(this.dx[ch]);
          this.x[ch] += smoothingAlpha(cutoff, dt) * (v - this.x[ch]);
        }
        out[idx] = this.x[ch];
      }
    }
    if (!stalled) {
      this.initialised = true;
      this.prevT = tMs;
    }
  }

  reset(): void {
    this.initialised = false;
    this.x.fill(0);
    this.dx.fill(0);
  }
}
