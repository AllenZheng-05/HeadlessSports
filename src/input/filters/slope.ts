/** Ring buffer of the last N samples; least-squares slope in units per SECOND. */
export class SlopeEstimator {
  private readonly size: number;
  private readonly values: Float64Array;
  private readonly times: Float64Array;
  private count = 0;
  private head = 0;

  constructor(window: number) {
    this.size = Math.max(2, Math.floor(window));
    this.values = new Float64Array(this.size);
    this.times = new Float64Array(this.size);
  }

  push(value: number, tMs: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(tMs)) return;
    this.values[this.head] = value;
    this.times[this.head] = tMs;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  /** 0 until two samples; 0 when all timestamps are equal. */
  slope(): number {
    const n = this.count;
    if (n < 2) return 0;
    const latest = this.times[(this.head - 1 + this.size) % this.size];
    let meanS = 0;
    let meanV = 0;
    for (let i = 0; i < n; i++) {
      meanS += (this.times[i] - latest) / 1000;
      meanV += this.values[i];
    }
    meanS /= n;
    meanV /= n;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const ds = (this.times[i] - latest) / 1000 - meanS;
      sxx += ds * ds;
      sxy += ds * (this.values[i] - meanV);
    }
    if (sxx < 1e-12) return 0;
    return sxy / sxx;
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
  }
}
