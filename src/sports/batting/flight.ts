import type { BattingConfig } from './config';

/** Sampling step of the stored trajectory, seconds. */
export const SAMPLE_DT = 1 / 60;
const SUBSTEPS = 4;
const DEG = Math.PI / 180;
const ROLL_S = 1.3;
const MAX_FLIGHT_S = 20;

/**
 * A hit ball's path in the plane of its heading: horizontal distance `d` from the plate and height
 * `y`, sampled every SAMPLE_DT seconds from the moment of contact. Built once per hit (an event),
 * read every frame without allocation.
 */
export interface Trajectory {
  d: Float32Array;
  y: Float32Array;
  count: number;
  grounder: boolean;
  /** Seconds in the air (0 for a grounder). */
  airS: number;
  /** Seconds until the ball stops. */
  totalS: number;
  /** Where it first lands, metres from the plate. */
  carry: number;
  /** Carry plus the roll: the scored distance. */
  total: number;
  maxHeight: number;
  homer: boolean;
  launchDeg: number;
  exitSpeed: number;
}

/** Exit speed, launch angle (degrees) -> path. Pure and deterministic. */
export function simulateHit(exitSpeed: number, launchDeg: number, cfg: BattingConfig): Trajectory {
  return launchDeg < cfg.groundMaxDeg
    ? simulateGrounder(exitSpeed, launchDeg, cfg)
    : simulateFly(exitSpeed, launchDeg, cfg);
}

function simulateGrounder(exitSpeed: number, launchDeg: number, cfg: BattingConfig): Trajectory {
  const tau = cfg.rollTau;
  const totalS = 4 * tau;
  const count = Math.ceil(totalS / SAMPLE_DT) + 1;
  const d = new Float32Array(count);
  const y = new Float32Array(count);
  const r = cfg.ballRadius;
  // A fast grounder skips a little; the hops die away with the speed.
  const hop = Math.min(0.18, exitSpeed * 0.004);
  for (let i = 0; i < count; i++) {
    const t = i * SAMPLE_DT;
    d[i] = exitSpeed * tau * (1 - Math.exp(-t / tau));
    const phase = Math.abs(Math.sin((t * Math.PI) / 0.32));
    y[i] = r + hop * phase * Math.exp(-t / (tau * 0.8));
  }
  const total = d[count - 1]!;
  return {
    d,
    y,
    count,
    grounder: true,
    airS: 0,
    totalS,
    carry: 0,
    total,
    maxHeight: r + hop,
    homer: false,
    launchDeg,
    exitSpeed,
  };
}

function simulateFly(exitSpeed: number, launchDeg: number, cfg: BattingConfig): Trajectory {
  const a = launchDeg * DEG;
  let vx = exitSpeed * Math.cos(a);
  let vy = exitSpeed * Math.sin(a);
  let x = 0;
  let y = cfg.hitStartHeight;
  const g = cfg.gravity;
  const k = cfg.drag;
  const h = SAMPLE_DT / SUBSTEPS;
  const maxSamples = Math.ceil(MAX_FLIGHT_S / SAMPLE_DT);
  const ds: number[] = [x];
  const ys: number[] = [y];
  let maxHeight = y;
  let homer = false;
  let fenceChecked = false;
  let landed = false;
  let carry = 0;
  let impactVy = 0;
  let blocked = false;
  while (!landed && ds.length < maxSamples) {
    for (let s = 0; s < SUBSTEPS; s++) {
      const sp = Math.hypot(vx, vy);
      const ax = -k * sp * vx;
      const ay = -g - k * sp * vy;
      vx += ax * h;
      vy += ay * h;
      const px = x;
      const py = y;
      x += vx * h;
      y += vy * h;
      if (!fenceChecked && x >= cfg.fenceDistance) {
        fenceChecked = true;
        const f = (cfg.fenceDistance - px) / Math.max(1e-9, x - px);
        const yAt = py + (y - py) * f;
        if (yAt > cfg.fenceHeight) homer = true;
        else {
          // Into the wall: the ball drops there.
          blocked = true;
          x = cfg.fenceDistance;
          y = Math.min(y, yAt);
          vx = 0;
          vy = Math.min(vy, 0);
        }
      }
      if (y > maxHeight) maxHeight = y;
      if (y <= 0 && vy < 0) {
        const f = py / Math.max(1e-9, py - y);
        carry = px + (x - px) * f;
        impactVy = vy;
        landed = true;
        break;
      }
    }
    if (landed) break;
    ds.push(x);
    ys.push(y);
    if (blocked) vx = 0;
  }
  if (!landed) carry = x;
  const airS = (ds.length - 1) * SAMPLE_DT + SAMPLE_DT * 0.5;
  const cos = Math.cos(a);
  let roll = blocked ? 0 : cfg.rollFactor * cos * cos * carry;
  if (homer) roll = Math.min(roll, 6);
  // Close the air path at the landing point, then roll out.
  ds.push(carry);
  ys.push(cfg.ballRadius);
  const rollSamples = Math.ceil(ROLL_S / SAMPLE_DT);
  const bounce = Math.min(1.2, Math.abs(impactVy) * 0.04);
  for (let i = 1; i <= rollSamples; i++) {
    const u = i / rollSamples;
    ds.push(carry + roll * (1 - (1 - u) * (1 - u)));
    const hopU = u < 0.45 ? Math.sin((u / 0.45) * Math.PI) : 0;
    ys.push(cfg.ballRadius + bounce * hopU);
  }
  const count = ds.length;
  return {
    d: Float32Array.from(ds),
    y: Float32Array.from(ys),
    count,
    grounder: false,
    airS,
    totalS: (count - 1) * SAMPLE_DT,
    carry,
    total: carry + roll,
    maxHeight,
    homer,
    launchDeg,
    exitSpeed,
  };
}

/** Trajectory sample at `tSec` after contact (clamped to the ends). Writes distance and height. No allocation. */
export function trajectoryAt(tr: Trajectory, tSec: number, out: { d: number; y: number }): void {
  if (!(tSec > 0)) {
    out.d = tr.d[0]!;
    out.y = tr.y[0]!;
    return;
  }
  const f = tSec / SAMPLE_DT;
  const i = Math.floor(f);
  if (i >= tr.count - 1) {
    out.d = tr.d[tr.count - 1]!;
    out.y = tr.y[tr.count - 1]!;
    return;
  }
  const u = f - i;
  out.d = tr.d[i]! + (tr.d[i + 1]! - tr.d[i]!) * u;
  out.y = tr.y[i]! + (tr.y[i + 1]! - tr.y[i]!) * u;
}

const scratchAt = { d: 0, y: 0 };

/**
 * World position of a hit ball `sinceContactMs` after the bat met it. Heading 0 is straight at the
 * pitcher (-z); positive degrees go toward screen right (+x). `originZ` is the plate. This is how a
 * hit that is resolved late is placed: from the time of contact, not from the time of resolution.
 */
export function hitWorldPosition(
  tr: Trajectory,
  headingDeg: number,
  originZ: number,
  sinceContactMs: number,
  out: { x: number; y: number; z: number },
): void {
  trajectoryAt(tr, sinceContactMs / 1000, scratchAt);
  const h = headingDeg * DEG;
  out.x = scratchAt.d * Math.sin(h);
  out.y = scratchAt.y;
  out.z = originZ - scratchAt.d * Math.cos(h);
}
