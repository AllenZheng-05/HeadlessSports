import { saturate } from './aim';
import type { ArcheryConfig } from './config';

/** The constants flight needs; a view of the config so tests can pass a plain object. */
export type FlightConfig = Pick<
  ArcheryConfig,
  | 'minArrowSpeed'
  | 'maxArrowSpeed'
  | 'gravity'
  | 'originX'
  | 'originY'
  | 'originZ'
  | 'targetDistance'
  | 'targetHeight'
>;

/** Arrow speed for a draw of 0..1, m/s. */
export function arrowSpeed(draw: number, cfg: FlightConfig): number {
  return cfg.minArrowSpeed + (cfg.maxArrowSpeed - cfg.minArrowSpeed) * saturate(draw);
}

/**
 * The launch pitch (radians) that hits the centre of the target at full draw with no wind and no
 * sideways aim: the flat-trajectory root of the ballistic quadratic in tan(pitch).
 */
export function basePitch(cfg: FlightConfig): number {
  const v = cfg.maxArrowSpeed;
  const run = cfg.targetDistance + cfg.originZ;
  const rise = cfg.targetHeight - cfg.originY;
  const a = (cfg.gravity * run * run) / (2 * v * v);
  // a * u^2 - run * u + (rise + a) = 0, u = tan(pitch)
  const disc = run * run - 4 * a * (rise + a);
  const u = disc <= 0 ? run / (2 * a) : (run - Math.sqrt(disc)) / (2 * a);
  return Math.atan(u);
}

export interface Hit {
  /** World x and y where the flight crosses the target plane, metres. */
  x: number;
  y: number;
  /** Flight time to the plane, seconds. */
  t: number;
}

/**
 * Analytic hit point on the target plane for a shot: draw 0..1, aim yaw and pitch (radians, added
 * to the centring pitch), constant crosswind acceleration `wind` along +x (m/s^2). Writes into
 * `out` and returns it. No allocation.
 */
export function hitOnPlane(
  cfg: FlightConfig,
  base: number,
  draw: number,
  yaw: number,
  pitch: number,
  wind: number,
  out: Hit,
): Hit {
  const v = arrowSpeed(draw, cfg);
  const p = base + pitch;
  const cp = Math.cos(p);
  const vx = v * Math.sin(yaw) * cp;
  const vy = v * Math.sin(p);
  const vz = -v * Math.cos(yaw) * cp;
  const t = (-cfg.targetDistance - cfg.originZ) / vz;
  out.t = t;
  out.x = cfg.originX + vx * t + 0.5 * wind * t * t;
  out.y = cfg.originY + vy * t - 0.5 * cfg.gravity * t * t;
  return out;
}

export const ArrowState = {
  Flying: 0,
  /** Reached the target plane inside the face and stuck. */
  Stuck: 1,
  /** Ended in the grass, the backstop or past the target. */
  Landed: 2,
} as const;
export type ArrowStateValue = (typeof ArrowState)[keyof typeof ArrowState];

/**
 * One arrow, stepped exactly under constant acceleration (gravity and a crosswind), so stepping at
 * any dt agrees with `hitOnPlane`. Crossing the target plane records the plane hit; inside the
 * face the arrow sticks there, otherwise it flies on to the ground or the backstop.
 */
export class Arrow {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  state: ArrowStateValue = ArrowState.Landed;
  /** Where the flight crossed the target plane (valid once `crossed`). */
  planeX = 0;
  planeY = 0;
  crossed = false;
  /** Seconds in flight. */
  age = 0;
  private wind = 0;
  private gravity = 9.81;

  launch(
    cfg: FlightConfig,
    base: number,
    draw: number,
    yaw: number,
    pitch: number,
    wind: number,
  ): void {
    const v = arrowSpeed(draw, cfg);
    const p = base + pitch;
    const cp = Math.cos(p);
    this.x = cfg.originX;
    this.y = cfg.originY;
    this.z = cfg.originZ;
    this.vx = v * Math.sin(yaw) * cp;
    this.vy = v * Math.sin(p);
    this.vz = -v * Math.cos(yaw) * cp;
    this.wind = wind;
    this.gravity = cfg.gravity;
    this.state = ArrowState.Flying;
    this.crossed = false;
    this.age = 0;
  }

  /**
   * Advance by `dt` seconds. `faceRadius` is the radius inside which the arrow sticks in the target;
   * `backZ` is the z of the backstop behind the target. Returns the new state.
   */
  step(dt: number, cfg: FlightConfig, faceRadius: number, backZ: number): ArrowStateValue {
    if (this.state !== ArrowState.Flying) return this.state;
    const g = this.gravity;
    const planeZ = -cfg.targetDistance;
    let left = dt;
    // The plane, the backstop and the ground are each found exactly inside the step.
    for (let guard = 0; guard < 3 && left > 0; guard++) {
      let s = left;
      let event = 0; // 1 plane, 2 backstop, 3 ground
      if (!this.crossed && this.vz < 0) {
        const sp = (planeZ - this.z) / this.vz;
        if (sp >= 0 && sp <= s) {
          s = sp;
          event = 1;
        }
      }
      if (this.crossed && this.vz < 0) {
        const sb = (backZ - this.z) / this.vz;
        if (sb >= 0 && sb <= s) {
          s = sb;
          event = 2;
        }
      }
      // y(s) = y + vy s - g s^2 / 2 = 0, positive root.
      const disc = this.vy * this.vy + 2 * g * this.y;
      if (disc >= 0) {
        const sg = (this.vy + Math.sqrt(disc)) / g;
        if (sg >= 0 && sg <= s) {
          s = sg;
          event = 3;
        }
      }
      this.advance(s);
      left -= s;
      if (event === 3) {
        this.y = Math.max(0, this.y);
        this.state = ArrowState.Landed;
        return this.state;
      }
      if (event === 2) {
        this.state = ArrowState.Landed;
        return this.state;
      }
      if (event === 1) {
        this.crossed = true;
        this.planeX = this.x;
        this.planeY = this.y;
        const r = Math.hypot(this.x, this.y - cfg.targetHeight);
        if (r <= faceRadius) {
          this.state = ArrowState.Stuck;
          return this.state;
        }
      } else {
        break;
      }
    }
    return this.state;
  }

  private advance(s: number): void {
    this.x += this.vx * s + 0.5 * this.wind * s * s;
    this.y += this.vy * s - 0.5 * this.gravity * s * s;
    this.z += this.vz * s;
    this.vx += this.wind * s;
    this.vy -= this.gravity * s;
    this.age += s;
  }
}
