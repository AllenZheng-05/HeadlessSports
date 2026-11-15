import type { Side } from '../../input/types';
import { createAim, placeAim } from './aim';
import type { Aim, LiveInput, PitchKind } from './aim';
import type { PitchingConfig } from './config';
import type { Point } from './zone';

const RING = 64;

/**
 * The continuous aim: where the pitch would cross the plate if released now, placed by the glove
 * hand. It is computed with the same `placeAim` as the release fallback and lightly smoothed (steady
 * under camera tracking).
 *
 * Locking: while the throwing wrist is at or above `lockSpeed` the ring holds. When that begins, it
 * is rewound `lockBackMs` (the glove arm may already be tucking as the throwing arm starts), then
 * held until the throwing wrist slows again. A release is scored from the ring value at the release
 * time, which is that held value. This is the speed-onset rule rather than a fixed lead before the
 * release: it adapts to slow and fast throws. If the ring was somehow not held at the release time
 * (a fast arm that never crossed the lock speed in a sample), the sample `fallbackLeadMs` earlier is
 * used instead.
 *
 * Glove lost: the ring holds its last value for `gloveGraceMs`, then eases to the centre of the
 * zone. It never stops the pitch.
 */
export class LiveAim {
  /** The current (smoothed) aim: what the marker shows. */
  readonly aim: Aim = createAim();
  private readonly raw: Aim = createAim();
  private readonly ringT = new Float64Array(RING);
  private readonly ringFrozen = new Uint8Array(RING);
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
  private frozen = false;
  private lastGloveT = -1;
  private everGlove = false;
  private heldBaseX = 0;
  private heldBaseY = 0;

  /** Forget everything (a new pitch). */
  reset(): void {
    this.count = 0;
    this.head = 0;
    this.valid = false;
    this.lastT = -1;
    this.frozen = false;
    this.everGlove = false;
    this.lastGloveT = -1;
  }

  /** Whether `aim` holds a real reading. */
  get ready(): boolean {
    return this.valid;
  }

  /** Whether the ring is held because the throwing arm is moving. */
  get locked(): boolean {
    return this.frozen;
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
    const a = this.aim;
    const snap = !this.valid || kind !== this.lastKind || target !== this.lastTarget;
    const dt = this.valid ? Math.max(0, t - this.lastT) : 0;

    const wantLock = input.speed >= cfg.lockSpeed && this.valid;
    if (wantLock) {
      if (!this.frozen) {
        // The throw has started: go back to what the ring showed just before it.
        if (this.at(t - cfg.lockBackMs, this.raw)) {
          a.rawX = this.raw.rawX;
          a.rawY = this.raw.rawY;
          a.x = this.raw.x;
          a.y = this.raw.y;
        }
      }
      this.frozen = true;
    } else {
      this.frozen = false;
      // Where the glove is, or where it was, or the centre of the zone.
      let bx = input.baseX;
      let by = input.baseY;
      let tau = cfg.aimSmoothMs;
      if (input.gloveTracked) {
        this.lastGloveT = t;
        this.everGlove = true;
      } else if (this.everGlove && t - this.lastGloveT <= cfg.gloveGraceMs) {
        // Hold the last value: aim at where the ring is now (its pre-curve, pre-assist base).
        bx = this.heldBaseX;
        by = this.heldBaseY;
      } else {
        bx = 0;
        by = cfg.zoneCentreY;
        tau = cfg.gloveEaseMs;
      }
      this.heldBaseX = bx;
      this.heldBaseY = by;
      placeAim(cfg, hand, kind, target, bx, by, input.speed, 0, this.raw, scratch);
      const r = this.raw;
      const k = snap ? 1 : 1 - Math.exp(-dt / Math.max(1, tau));
      a.rawX += (r.rawX - a.rawX) * k;
      a.rawY += (r.rawY - a.rawY) * k;
      a.x += (r.x - a.x) * k;
      a.y += (r.y - a.y) * k;
    }
    this.lastT = t;
    this.lastKind = kind;
    this.lastTarget = target;
    this.valid = true;
    const h = this.head;
    this.ringT[h] = t;
    this.ringFrozen[h] = this.frozen ? 1 : 0;
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
    this.ringFrozen[h] = 0;
    this.ringRawX[h] = x;
    this.ringRawY[h] = y;
    this.ringX[h] = x;
    this.ringY[h] = y;
    this.head = (h + 1) % RING;
    if (this.count < RING) this.count++;
  }

  /** Ring index of the newest sample at or before `t` (else the oldest), or -1 when empty. */
  private pick(t: number): number {
    const n = this.count;
    if (n === 0) return -1;
    let pick = (this.head - n + RING) % RING;
    for (let k = 0; k < n; k++) {
      const i = (this.head - n + k + RING) % RING;
      if (this.ringT[i]! <= t + 1) pick = i;
      else break;
    }
    return pick;
  }

  /**
   * The aim the indicator showed at time `t` (the newest sample at or before it, else the oldest),
   * written into `out`'s position fields. False when nothing has been read.
   */
  at(t: number, out: Aim): boolean {
    const i = this.pick(t);
    if (i < 0) return false;
    out.rawX = this.ringRawX[i]!;
    out.rawY = this.ringRawY[i]!;
    out.x = this.ringX[i]!;
    out.y = this.ringY[i]!;
    return true;
  }

  /**
   * The base aim for a release event stamped `t`. Camera: the ring value at `t`, which is the held
   * (locked) value; if the ring was not held then, the value `fallbackLeadMs` earlier. The mouse
   * has no lock: pass `tracked = false`.
   */
  forRelease(cfg: PitchingConfig, t: number, tracked: boolean, out: Aim): boolean {
    if (!tracked) return this.at(t, out);
    const i = this.pick(t);
    if (i < 0) return false;
    if (this.ringFrozen[i] === 1) return this.at(t, out);
    return this.at(t - cfg.lockFallbackLeadMs, out);
  }
}
