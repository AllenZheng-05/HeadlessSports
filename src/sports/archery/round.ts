/** One arrow's result. `r` is the distance from the centre of the face, metres. */
export interface ArrowResult {
  ring: number;
  r: number;
}

/** Round bookkeeping: arrow count, ring scores, totals. Pure. */
export class ArcheryRound {
  readonly total: number;
  readonly shots: ArrowResult[] = [];
  private finished = false;

  constructor(arrows: number) {
    this.total = Math.max(1, Math.floor(arrows));
  }

  get taken(): number {
    return this.shots.length;
  }

  get left(): number {
    return this.total - this.shots.length;
  }

  get over(): boolean {
    return this.shots.length >= this.total;
  }

  record(ring: number, r: number): void {
    if (this.over) return;
    this.shots.push({ ring, r });
  }

  get score(): number {
    let sum = 0;
    for (const s of this.shots) sum += s.ring;
    return sum;
  }

  get tens(): number {
    let n = 0;
    for (const s of this.shots) if (s.ring === 10) n++;
    return n;
  }

  get misses(): number {
    let n = 0;
    for (const s of this.shots) if (s.ring === 0) n++;
    return n;
  }

  get bestRing(): number {
    let best = 0;
    for (const s of this.shots) if (s.ring > best) best = s.ring;
    return best;
  }

  /** Mean distance from the centre over all arrows, centimetres. */
  get meanErrorCm(): number {
    if (this.shots.length === 0) return 0;
    let sum = 0;
    for (const s of this.shots) sum += s.r;
    return (sum / this.shots.length) * 100;
  }

  /** "10, 8, 9, M, 10, 3" */
  ringsText(): string {
    return this.shots.map((s) => (s.ring === 0 ? 'M' : String(s.ring))).join(', ');
  }

  /** True exactly once, when the round is over: the caller then calls `finish`. */
  takeFinish(): boolean {
    if (!this.over || this.finished) return false;
    this.finished = true;
    return true;
  }
}
