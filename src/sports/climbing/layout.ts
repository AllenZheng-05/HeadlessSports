import type { ClimbingConfig } from './config';

export const KIND_JUG = 0;
export const KIND_CRIMP = 1;
/** Pastel colour slots for jugs; crimps have their own. Resolved to colours by the scene. */
export const TINT_COUNT = 5;

/** First row starts here: nothing to grab below shoulder height at the start. */
const FIRST_ROW_Y = 0.8;
/** Holds in a row all lie within [rowBase, rowBase + ROW_SPAN). */
const ROW_SPAN = 0.35;
/** Holds this close to a ledge top are left out (the shelf is there). */
const LEDGE_CLEAR = 0.12;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the rules need from the wall. */
export interface HoldField {
  /** Nearest hold whose own grab radius contains (x, y), skipping two indices; -1 for none. */
  findNearest(x: number, y: number, skipA: number, skipB: number): number;
  holdX(i: number): number;
  holdY(i: number): number;
  holdKind(i: number): number;
  /** Top of the ledge (or the ground, 0) the feet stand on, or -1 when not standing. */
  standLevel(feetY: number): number;
}

type LayoutConfig = Pick<
  ClimbingConfig,
  | 'rowStepM'
  | 'rowJitterM'
  | 'lateralRange'
  | 'centreGapM'
  | 'minSpacingM'
  | 'extraHoldChance'
  | 'crimpStartM'
  | 'crimpBase'
  | 'crimpPerMetre'
  | 'crimpMax'
  | 'ledgeEveryM'
  | 'ledgeStandBelowM'
  | 'ledgeStandAboveM'
  | 'jugRadius'
  | 'crimpRadius'
>;

/**
 * The wall's holds, generated lazily in rows as the climber rises. Every row carries one hold in
 * each lateral half (so a route always exists, with at most `rowStepM + rowJitterM` between holds
 * of one half) plus random extras. Fully determined by the random source.
 */
export class Layout implements HoldField {
  count = 0;
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly kinds: number[] = [];
  /** Visual only: tilt (rad), size multiplier, tint slot. */
  readonly tilt: number[] = [];
  readonly size: number[] = [];
  readonly tint: number[] = [];
  /** rowStart[k] is the index of the first hold of row k; rowStart[rows] === count. */
  readonly rowStart: number[] = [0];
  /** Order-sensitive hash of every hold below 40 m, for reproducibility checks. */
  readonly checksum: number;

  private readonly cfg: LayoutConfig;
  private readonly random: () => number;

  constructor(random: () => number, cfg: LayoutConfig) {
    this.random = random;
    this.cfg = cfg;
    this.ensure(44);
    let h = 2166136261;
    for (let i = 0; i < this.count; i++) {
      if (this.ys[i]! >= 40) continue;
      h = Math.imul(h ^ Math.round(this.xs[i]! * 1000), 16777619);
      h = Math.imul(h ^ Math.round(this.ys[i]! * 1000), 16777619);
      h = Math.imul(h ^ this.kinds[i]!, 16777619);
    }
    this.checksum = h >>> 0;
  }

  get rows(): number {
    return this.rowStart.length - 1;
  }

  /** Generate rows until holds are placed up to height `topY`. Cheap when already there. */
  ensure(topY: number): void {
    const step = this.cfg.rowStepM;
    while (FIRST_ROW_Y + this.rows * step < topY) this.addRow(this.rows);
  }

  rowBase(row: number): number {
    return FIRST_ROW_Y + row * this.cfg.rowStepM;
  }

  /** Row index whose base is at or below y, clamped to >= 0. */
  rowOf(y: number): number {
    return Math.max(0, Math.floor((y - FIRST_ROW_Y) / this.cfg.rowStepM));
  }

  /** Is the point within min spacing of an existing hold? */
  private tooClose(x: number, y: number): boolean {
    const min = this.cfg.minSpacingM;
    const from = this.rowStart[Math.min(this.rows, this.rowOf(y - min - ROW_SPAN))]!;
    for (let i = from; i < this.count; i++) {
      const dx = this.xs[i]! - x;
      const dy = this.ys[i]! - y;
      if (dx * dx + dy * dy < min * min) return true;
    }
    return false;
  }

  private inLedgeZone(y: number): boolean {
    const every = this.cfg.ledgeEveryM;
    const near = Math.round(y / every) * every;
    return near >= every && Math.abs(y - near) < LEDGE_CLEAR;
  }

  private place(x: number, y: number): void {
    const r = this.random;
    let crimpP = 0;
    if (y > this.cfg.crimpStartM) {
      crimpP = Math.min(
        this.cfg.crimpMax,
        this.cfg.crimpBase + (y - this.cfg.crimpStartM) * this.cfg.crimpPerMetre,
      );
    }
    this.xs.push(x);
    this.ys.push(y);
    this.kinds.push(r() < crimpP ? KIND_CRIMP : KIND_JUG);
    this.tilt.push((r() - 0.5) * 0.8);
    this.size.push(0.88 + r() * 0.26);
    this.tint.push(Math.floor(r() * TINT_COUNT));
    this.count++;
  }

  private addRow(row: number): void {
    const cfg = this.cfg;
    const r = this.random;
    const base = this.rowBase(row);
    const range = cfg.lateralRange;
    const gap = cfg.centreGapM;
    for (let half = 0; half < 2; half++) {
      const lo = half === 0 ? -range : gap;
      const hi = half === 0 ? -gap : range;
      const y = base + r() * cfg.rowJitterM;
      let x = lo + r() * (hi - lo);
      let ok = false;
      for (let tries = 0; tries < 30 && !ok; tries++) {
        ok = !this.tooClose(x, y);
        if (!ok) x = lo + r() * (hi - lo);
      }
      if (!ok) {
        for (let k = 0; k <= 40 && !ok; k++) {
          x = lo + ((hi - lo) * k) / 40;
          ok = !this.tooClose(x, y);
        }
      }
      if (!this.inLedgeZone(y)) this.place(x, y);
    }
    if (r() < cfg.extraHoldChance) {
      for (let tries = 0; tries < 12; tries++) {
        const x = (r() * 2 - 1) * range;
        const y = base + r() * ROW_SPAN;
        if (this.inLedgeZone(y) || this.tooClose(x, y)) continue;
        this.place(x, y);
        break;
      }
    }
    this.rowStart.push(this.count);
  }

  holdX(i: number): number {
    return this.xs[i]!;
  }
  holdY(i: number): number {
    return this.ys[i]!;
  }
  holdKind(i: number): number {
    return this.kinds[i]!;
  }

  radiusOf(i: number): number {
    return this.kinds[i] === KIND_CRIMP ? this.cfg.crimpRadius : this.cfg.jugRadius;
  }

  findNearest(x: number, y: number, skipA: number, skipB: number): number {
    const maxR = Math.max(this.cfg.jugRadius, this.cfg.crimpRadius);
    const rLo = Math.min(this.rows, this.rowOf(y - maxR - ROW_SPAN));
    const rHi = Math.min(this.rows, this.rowOf(y + maxR) + 1);
    const from = this.rowStart[rLo]!;
    const to = this.rowStart[rHi]!;
    let best = -1;
    let bestD = Infinity;
    for (let i = from; i < to; i++) {
      if (i === skipA || i === skipB) continue;
      const dx = this.xs[i]! - x;
      const dy = this.ys[i]! - y;
      const d = dx * dx + dy * dy;
      const r = this.radiusOf(i);
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Height of the ledge number k (k = 0 is the ground). */
  ledgeY(k: number): number {
    return k * this.cfg.ledgeEveryM;
  }

  standLevel(feetY: number): number {
    const every = this.cfg.ledgeEveryM;
    const k = Math.max(0, Math.round(feetY / every));
    const level = k * every;
    const d = feetY - level;
    return d >= -this.cfg.ledgeStandBelowM && d <= this.cfg.ledgeStandAboveM ? level : -1;
  }
}
