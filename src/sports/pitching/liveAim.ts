import type { Side } from '../../input/types';
import { createAim, placeAim } from './aim';
import type { Aim, LiveInput, PitchKind } from './aim';
import type { PitchingConfig } from './config';
import type { Point } from './zone';

const RING = 64;

/**
 * The continuous aim: where the pitch would cross the plate if released now. It is computed with the
 * same `placeAim` as the release, lightly smoothed while the arm is slow (steady under camera
 * tracking) and not smoothed at throw speed. Every sample is kept for a moment, so a release is
 * scored from exactly what the indicator showed at the release time.
 */
export class LiveAim {
  /** The current (smoothed) aim: what the marker shows. */
  readonly aim: Aim = createAim();
  private readonly raw: Aim = createAim();
  private readonly ringT = new Float64Array(RING);
  private readonly ringSpeed = new Float32Array(RING);
  private readonly ringRawX = new Float32Array(RING);
  private readonly ringRawY = new Float32Array(RING);
  private readonly ringX = new Float32Array(RING);
  private readonly ringY = new Float32Array(RING);
  private head = 0;
  private count = 0;
  private lastT = -1;
  private lastKind: PitchKind = 'fastball';
  private lastTarget = -1;
  private valid = false;

  /** Forget everything (a new pitch, or the hand was lost). */
  reset(): void {
    this.count = 0;
    this.head = 0;
    this.valid = false;
    this.lastT = -1;
  }

  /** Whether `aim` holds a real reading. */
  get ready(): boolean {
    return this.valid;
  }

  /** Fold in one reading taken at game time `t`. Ignores a repeated timestamp. */
  update(
    cfg: PitchingConfig,
    t: number,
    input: LiveInput,
    hand: Side,
    kind: PitchKind,
    target: number,
    scratch: Point,
  ): void {
    if (this.valid && t === this.lastT) return;
    placeAim(
      cfg,
      hand,
      kind,
      target,
      input.lateral,
      input.yOffset,
      input.speed,
      0,
      this.raw,
      scratch,
    );
    const a = this.aim;
    const r = this.raw;
    const snap = !this.valid || kind !== this.lastKind || target !== this.lastTarget;
    const fast = input.speed >= cfg.minThrowSpeed * cfg.aimFastFraction;
    let k = 1;
    if (!snap && !fast) {
      const dt = Math.max(0, t - this.lastT);
      k = 1 - Math.exp(-dt / Math.max(1, cfg.aimSmoothMs));
    }
    a.rawX += (r.rawX - a.rawX) * k;
    a.rawY += (r.rawY - a.rawY) * k;
    a.x += (r.x - a.x) * k;
    a.y += (r.y - a.y) * k;
    this.lastT = t;
    this.lastKind = kind;
    this.lastTarget = target;
    this.valid = true;
    const h = this.head;
    this.ringT[h] = t;
    this.ringSpeed[h] = input.speed;
    this.ringRawX[h] = a.rawX;
    this.ringRawY[h] = a.rawY;
    this.ringX[h] = a.x;
    this.ringY[h] = a.y;
    this.head = (h + 1) % RING;
    if (this.count < RING) this.count++;
  }

  /**
   * Mouse play: the indicator is exactly the pointed spot (scored plane, m), unsmoothed and with no
   * zone assist, so the ring sits where the cursor is and the pitch lands there.
   */
  setDirect(t: number, x: number, y: number): void {
    const a = this.aim;
    a.rawX = x;
    a.rawY = y;
    a.x = x;
    a.y = y;
    this.lastT = t;
    this.valid = true;
    const h = this.head;
    this.ringT[h] = t;
    this.ringSpeed[h] = 99;
    this.ringRawX[h] = x;
    this.ringRawY[h] = y;
    this.ringX[h] = x;
    this.ringY[h] = y;
    this.head = (h + 1) % RING;
    if (this.count < RING) this.count++;
  }

  /**
   * The aim the indicator showed when the arm was fastest within [t0, t1]. A release event is
   * stamped with the position-time of the peak while its velocity is read a few frames later, so
   * the release is matched to the fastest sample around it. False when no sample is in the window.
   */
  atPeak(t0: number, t1: number, out: Aim): boolean {
    const n = this.count;
    let best = -1;
    let bestSpeed = -1;
    for (let k = 0; k < n; k++) {
      const i = (this.head - n + k + RING) % RING;
      const t = this.ringT[i]!;
      if (t < t0 || t > t1) continue;
      if (this.ringSpeed[i]! >= bestSpeed) {
        bestSpeed = this.ringSpeed[i]!;
        best = i;
      }
    }
    if (best < 0) return false;
    out.rawX = this.ringRawX[best]!;
    out.rawY = this.ringRawY[best]!;
    out.x = this.ringX[best]!;
    out.y = this.ringY[best]!;
    return true;
  }

  /**
   * The aim the indicator showed at time `t` (the newest sample at or before it, else the oldest),
   * written into `out`'s position fields. False when nothing has been read.
   */
  at(t: number, out: Aim): boolean {
    const n = this.count;
    if (n === 0) return false;
    let pick = (this.head - n + RING) % RING;
    for (let k = 0; k < n; k++) {
      const i = (this.head - n + k + RING) % RING;
      if (this.ringT[i] <= t + 1) pick = i;
      else break;
    }
    out.rawX = this.ringRawX[pick]!;
    out.rawY = this.ringRawY[pick]!;
    out.x = this.ringX[pick]!;
    out.y = this.ringY[pick]!;
    return true;
  }

  /**
   * The aim for a release event stamped `t`: sideways is what the indicator showed at `t` (the
   * position-time of the peak), height is what it showed when the arm was fastest around it (the
   * event's velocity is read a few frames after its timestamp). Both are values the indicator
   * showed. The mouse has no such lag: pass `peak = false`.
   */
  forRelease(t: number, peak: boolean, out: Aim): boolean {
    if (!this.at(t, out)) return false;
    if (!peak) return true;
    const x = out.x;
    const rawX = out.rawX;
    if (!this.atPeak(t - 40, t + 250, out)) return true;
    out.x = x;
    out.rawX = rawX;
    return true;
  }
}
