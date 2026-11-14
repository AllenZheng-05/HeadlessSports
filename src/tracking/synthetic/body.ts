/**
 * Forward model of the synthetic player: `BodyControls` -> MediaPipe-style landmarks.
 *
 * Working units: "height units" (hu) are fractions of image height, y down. Distances are measured
 * in shoulder widths (sw) times the control's `shoulderWidth`. Only at the very end is x divided by
 * the aspect to get mirrored normalised x. Left landmarks sit at smaller x than right ones.
 *
 * Conventions chosen where the contract was open:
 * - Pose z: normalised like x (z_hu / aspect), negative toward the camera. Torso 0, raised knees and
 *   raised wrists slightly negative.
 * - World landmarks: metres, hip-midpoint origin, assuming a shoulder width of 0.38 m. x is mirrored
 *   (positive toward screen right), y is positive DOWN (up is negative, as MediaPipe reports), z is
 *   negative toward the camera. Coarse: derived from the 2D layout, not from real depth.
 * - Sway: a slow body-wide drift of amplitude 1.5 x `sigma` (so it vanishes when sigma is 0).
 */
import type { BodyControls } from './controls';
import type { LandmarkFrame } from '../types';
import { HAND_COUNT, HAND_STRIDE, POSE_COUNT, POSE_STRIDE, WORLD_STRIDE } from '../types';

export interface NoiseOptions {
  /** Gaussian sigma on pose coordinates, normalised units. Default 0.0015. */
  sigma: number;
  seed: number;
  /** Gaussian sigma on hand coordinates. Default 0.7 x sigma. */
  handSigma?: number;
  /** Chance per hand per frame that a visible hand is not detected. Default 0. */
  dropHandChance?: number;
}

// Skeleton proportions in shoulder widths.
const HIP_WIDTH = 0.62;
const TORSO = 1.45;
const THIGH = 1.15;
const SHIN = 1.1;
const UPPER_ARM = 0.8;
const FOREARM = 0.72;
const NECK_TO_NOSE = 0.55;
const PALM = 0.19;
const STAND_LEG = 2.24;
const CROUCH_DROP = 1.2;
const WORLD_SW_M = 0.38;
const SWAY_FPS = 30;

/**
 * Hand templates as (lateral, forward) pairs per landmark, in palm lengths (wrist to middle MCP = 1).
 * Lateral is positive toward the thumb side. Open scores about 1.88 on the curl metric, fist 0.56.
 */
// prettier-ignore
const OPEN = new Float64Array([
  0, 0, // wrist
  0.25, 0.25, 0.45, 0.5, 0.62, 0.72, 0.75, 0.92, // thumb
  0.22, 0.97, 0.25, 1.4, 0.26, 1.7, 0.27, 1.92, // index
  0, 1, 0, 1.45, 0, 1.78, 0, 2.02, // middle
  -0.2, 0.95, -0.22, 1.38, -0.23, 1.67, -0.24, 1.88, // ring
  -0.4, 0.85, -0.44, 1.2, -0.46, 1.43, -0.47, 1.6, // pinky
]);
// prettier-ignore
const FIST = new Float64Array([
  0, 0,
  0.25, 0.25, 0.38, 0.45, 0.3, 0.62, 0.12, 0.66,
  0.22, 0.97, 0.25, 1.15, 0.25, 0.82, 0.22, 0.52,
  0, 1, 0, 1.2, 0, 0.86, 0, 0.55,
  -0.2, 0.95, -0.22, 1.12, -0.22, 0.8, -0.2, 0.5,
  -0.4, 0.85, -0.43, 1, -0.42, 0.72, -0.38, 0.45,
]);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Allocates the reusable arrays once. */
export function createEmptyFrame(aspect = 16 / 9): LandmarkFrame {
  const hand = () => ({
    present: false,
    score: 0,
    landmarks: new Float32Array(HAND_COUNT * HAND_STRIDE),
  });
  return {
    t: 0,
    seq: 0,
    inferenceMs: 0,
    aspect,
    hasPose: false,
    pose: new Float32Array(POSE_COUNT * POSE_STRIDE),
    poseWorld: new Float32Array(POSE_COUNT * WORLD_STRIDE),
    hands: [hand(), hand()],
  };
}

/** Forward model: controls -> landmarks. Deterministic for a given seed. No allocation in `write`. */
export class SyntheticBody {
  private readonly aspect: number;
  private readonly sigma: number;
  private readonly handSigma: number;
  private readonly dropChance: number;
  private rng: () => number;
  private spare = 0;
  private hasSpare = false;
  private frameIndex = 0;
  private swayPhase = 0;

  // Scratch, all in hu.
  private readonly px = new Float64Array(POSE_COUNT);
  private readonly py = new Float64Array(POSE_COUNT);
  private readonly pz = new Float64Array(POSE_COUNT);
  private readonly hx = new Float64Array(HAND_COUNT * 2);
  private readonly hy = new Float64Array(HAND_COUNT * 2);
  private readonly sol = new Float64Array(4);

  constructor(aspect = 16 / 9, noise: Partial<NoiseOptions> = {}) {
    this.aspect = aspect;
    this.sigma = noise.sigma ?? 0.0015;
    this.handSigma = noise.handSigma ?? this.sigma * 0.7;
    this.dropChance = noise.dropHandChance ?? 0;
    this.rng = mulberry32(noise.seed ?? 1);
    this.swayPhase = this.phaseFor(noise.seed ?? 1);
  }

  reseed(seed: number): void {
    this.rng = mulberry32(seed);
    this.hasSpare = false;
    this.frameIndex = 0;
    this.swayPhase = this.phaseFor(seed);
  }

  private phaseFor(seed: number): number {
    return ((seed * 0.6180339887) % 1) * Math.PI * 2;
  }

  private gauss(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = this.rng();
    if (u < 1e-12) u = 1e-12;
    const v = this.rng();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    this.hasSpare = true;
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Fill frame.pose, frame.poseWorld, frame.hands, frame.hasPose, frame.aspect. Does not set t or seq. */
  write(c: BodyControls, frame: LandmarkFrame): void {
    frame.aspect = this.aspect;
    const ts = this.frameIndex / SWAY_FPS;
    this.frameIndex++;
    const amp = this.sigma * 1.5;
    const ph = this.swayPhase;
    const sx =
      amp *
      (Math.sin(2 * Math.PI * 0.37 * ts + ph) + 0.5 * Math.sin(2 * Math.PI * 0.91 * ts + 1.3 + ph));
    const sy = amp * 0.7 * Math.sin(2 * Math.PI * 0.5 * ts + 0.7 + ph);

    const handsOnly = c.handsOnly >= 0.5;
    const bodyOn = c.bodyVisible >= 0.5 && !handsOnly;
    frame.hasPose = bodyOn;
    if (bodyOn) this.writeBody(c, frame, sx, sy);
    else if (handsOnly) this.buildHandsOnly(c, sx, sy);

    const asp = this.aspect;
    const hs = this.handSigma;
    for (let h = 0; h < 2; h++) {
      const visible = (h === 0 ? c.leftHandVisible : c.rightHandVisible) >= 0.5;
      let present = visible && (bodyOn || handsOnly);
      if (this.dropChance > 0 && present && this.rng() < this.dropChance) present = false;
      const obs = frame.hands[h];
      obs.present = present;
      obs.score = present ? 0.9 : 0;
      if (!present) continue;
      const lm = obs.landmarks;
      const base = h * HAND_COUNT;
      for (let i = 0; i < HAND_COUNT; i++) {
        const o = i * HAND_STRIDE;
        lm[o] = this.hx[base + i] / asp + (hs > 0 ? this.gauss() * hs : 0);
        lm[o + 1] = this.hy[base + i] + (hs > 0 ? this.gauss() * hs : 0);
        lm[o + 2] = 0;
      }
    }
  }

  private buildHandsOnly(c: BodyControls, sx: number, sy: number): void {
    const asp = this.aspect;
    const palm = c.handSize;
    // Palm centre is the midpoint of wrist and middle MCP; fingers up, so the wrist sits half a palm below.
    const lx = (c.leftHandX + sx) * asp;
    const ly = c.leftHandY + sy + palm * 0.5;
    const rx = (c.rightHandX + sx) * asp;
    const ry = c.rightHandY + sy + palm * 0.5;
    this.buildHand(0, lx, ly, 0, -1, palm, c.leftFist, 1);
    this.buildHand(1, rx, ry, 0, -1, palm, c.rightFist, -1);
  }

  /** Hand landmarks in hu. (fx, fy) is the unit direction wrist -> fingers. */
  private buildHand(
    h: number,
    wx: number,
    wy: number,
    fx: number,
    fy: number,
    palm: number,
    fist: number,
    latSign: number,
  ): void {
    const lx = -fy * latSign;
    const ly = fx * latSign;
    const base = h * HAND_COUNT;
    for (let i = 0; i < HAND_COUNT; i++) {
      const lat = OPEN[2 * i] + (FIST[2 * i] - OPEN[2 * i]) * fist;
      const fwd = OPEN[2 * i + 1] + (FIST[2 * i + 1] - OPEN[2 * i + 1]) * fist;
      this.hx[base + i] = wx + (fx * fwd + lx * lat) * palm;
      this.hy[base + i] = wy + (fy * fwd + ly * lat) * palm;
    }
  }

  /**
   * Two-bone solve in 2D from (ax, ay) toward (tx, ty). Result in `sol`: joint x, y, end x, y.
   * The joint bends toward the preference direction (prefX, prefY).
   */
  private solve(
    ax: number,
    ay: number,
    tx: number,
    ty: number,
    l1: number,
    l2: number,
    prefX: number,
    prefY: number,
  ): void {
    let dx = tx - ax;
    let dy = ty - ay;
    let d = Math.hypot(dx, dy);
    if (d < 1e-9) {
      dx = 0;
      dy = 1;
      d = 1e-9;
    }
    const ux = dx / d;
    const uy = dy / d;
    const maxD = (l1 + l2) * 0.9999;
    const minD = Math.abs(l1 - l2) * 1.0001 + 1e-9;
    if (d > maxD) d = maxD;
    if (d < minD) d = minD;
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    const mx = ax + ux * a;
    const my = ay + uy * a;
    const nx = -uy;
    const ny = ux;
    const sign = nx * prefX + ny * prefY >= 0 ? 1 : -1;
    this.sol[0] = mx + nx * h * sign;
    this.sol[1] = my + ny * h * sign;
    this.sol[2] = ax + ux * d;
    this.sol[3] = ay + uy * d;
  }

  private setPt(i: number, x: number, y: number, z: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
  }

  private writeBody(c: BodyControls, frame: LandmarkFrame, sx: number, sy: number): void {
    const asp = this.aspect;
    const sw = c.shoulderWidth;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;

    // Upright shoulder midpoint; crouch and jump move the whole upper body vertically.
    const s0x = (c.centreX + sx) * asp;
    const s0y = c.shoulderY + sy;
    const drop = (c.crouch * CROUCH_DROP - c.jump) * sw;
    const hipX = s0x;
    const hipY = s0y + TORSO * sw + drop;
    // Lean rotates the torso about the hip midpoint.
    const ux = Math.sin(c.lean);
    const uy = -Math.cos(c.lean);
    const rx = Math.cos(c.lean);
    const ry = Math.sin(c.lean);
    const smx = hipX + ux * TORSO * sw;
    const smy = hipY + uy * TORSO * sw;
    const lsx = smx - 0.5 * sw * rx;
    const lsy = smy - 0.5 * sw * ry;
    const rsx = smx + 0.5 * sw * rx;
    const rsy = smy + 0.5 * sw * ry;
    this.setPt(11, lsx, lsy, 0);
    this.setPt(12, rsx, rsy, 0);
    const lhx = hipX - 0.5 * HIP_WIDTH * sw;
    const rhx = hipX + 0.5 * HIP_WIDTH * sw;
    this.setPt(23, lhx, hipY, 0);
    this.setPt(24, rhx, hipY, 0);

    // Head: nose above the shoulders along the torso axis; the face cluster is placed in the head frame.
    const nx = smx + ux * NECK_TO_NOSE * sw;
    const ny = smy + uy * NECK_TO_NOSE * sw;
    this.setPt(0, nx, ny, -0.1 * sw);
    this.face(1, nx, ny, ux, uy, rx, ry, sw, -0.06, 0.12);
    this.face(2, nx, ny, ux, uy, rx, ry, sw, -0.12, 0.14);
    this.face(3, nx, ny, ux, uy, rx, ry, sw, -0.2, 0.12);
    this.face(4, nx, ny, ux, uy, rx, ry, sw, 0.06, 0.12);
    this.face(5, nx, ny, ux, uy, rx, ry, sw, 0.12, 0.14);
    this.face(6, nx, ny, ux, uy, rx, ry, sw, 0.2, 0.12);
    this.face(7, nx, ny, ux, uy, rx, ry, sw, -0.32, 0.05);
    this.face(8, nx, ny, ux, uy, rx, ry, sw, 0.32, 0.05);
    this.face(9, nx, ny, ux, uy, rx, ry, sw, -0.09, -0.14);
    this.face(10, nx, ny, ux, uy, rx, ry, sw, 0.09, -0.14);

    // Arms.
    this.arm(-1, lsx, lsy, c.leftWristX, c.leftWristY, sw, 13, 0, c.leftFist);
    this.arm(1, rsx, rsy, c.rightWristX, c.rightWristY, sw, 14, 1, c.rightFist);

    // Legs. Ankles stay on the ground line (rising with `jump`); hips drop with `crouch`.
    const ankleY = s0y + (TORSO + STAND_LEG) * sw - c.jump * sw;
    this.leg(-1, lhx, hipY, lhx - 0.04 * sw, ankleY, sw, c.leftKnee, 25);
    this.leg(1, rhx, hipY, rhx + 0.04 * sw, ankleY, sw, c.rightKnee, 26);

    // World landmarks: hip-centred metres.
    const wk = sw > 1e-6 ? WORLD_SW_M / sw : 0;
    const world = frame.poseWorld;
    for (let i = 0; i < POSE_COUNT; i++) {
      const o = i * WORLD_STRIDE;
      world[o] = (px[i] - hipX) * wk;
      world[o + 1] = (py[i] - hipY) * wk;
      world[o + 2] = pz[i] * wk;
    }

    // Pose output with noise and visibility.
    const pose = frame.pose;
    const sg = this.sigma;
    for (let i = 0; i < POSE_COUNT; i++) {
      const o = i * POSE_STRIDE;
      const nxm = px[i] / asp;
      const nym = py[i];
      const inside = nxm >= 0 && nxm <= 1 && nym >= 0 && nym <= 1;
      pose[o] = nxm + (sg > 0 ? this.gauss() * sg : 0);
      pose[o + 1] = nym + (sg > 0 ? this.gauss() * sg : 0);
      pose[o + 2] = pz[i] / asp + (sg > 0 ? this.gauss() * sg : 0);
      pose[o + 3] = inside ? 0.95 : 0.9;
    }
  }

  private face(
    i: number,
    nx: number,
    ny: number,
    ux: number,
    uy: number,
    rx: number,
    ry: number,
    sw: number,
    a: number,
    b: number,
  ): void {
    this.setPt(i, nx + (rx * a + ux * b) * sw, ny + (ry * a + uy * b) * sw, -0.05 * sw);
  }

  /**
   * Shoulder (sx, sy) -> wrist target. Writes elbow, wrist and the three finger-base landmarks
   * (elbow index `iElbow`, wrist +2, pinky +4, index +6, thumb +8) and builds the hand model.
   */
  private arm(
    side: number,
    sx: number,
    sy: number,
    wxRel: number,
    wyRel: number,
    sw: number,
    iElbow: number,
    hand: number,
    fist: number,
  ): void {
    this.solve(sx, sy, sx + wxRel * sw, sy - wyRel * sw, UPPER_ARM * sw, FOREARM * sw, side, 0.5);
    const ex = this.sol[0];
    const ey = this.sol[1];
    const wx = this.sol[2];
    const wy = this.sol[3];
    // Raised arms reach forward a little: z grows more negative as the wrist rises above hanging.
    const lift = Math.min(Math.max((wyRel + 1.4) / 1.4, 0), 1);
    const zw = -0.3 * sw * lift;
    this.setPt(iElbow, ex, ey, -0.1 * sw * lift);
    this.setPt(iElbow + 2, wx, wy, zw);
    let fx = wx - ex;
    let fy = wy - ey;
    const fl = Math.hypot(fx, fy);
    if (fl < 1e-9) {
      fx = 0;
      fy = 1;
    } else {
      fx /= fl;
      fy /= fl;
    }
    this.buildHand(hand, wx, wy, fx, fy, PALM * sw, fist, -side);
    const b = hand * HAND_COUNT;
    // Palm-side landmarks of the hand model stand in for pinky, index and thumb.
    this.setPt(iElbow + 4, this.hx[b + 17], this.hy[b + 17], zw);
    this.setPt(iElbow + 6, this.hx[b + 5], this.hy[b + 5], zw);
    this.setPt(iElbow + 8, this.hx[b + 3], this.hy[b + 3], zw);
  }

  /** Hip -> ankle target. Writes knee (`iKnee`), ankle (+2), heel (+4) and foot index (+6). */
  private leg(
    side: number,
    hx: number,
    hy: number,
    ax: number,
    ay: number,
    sw: number,
    lift: number,
    iKnee: number,
  ): void {
    this.solve(hx, hy, ax, ay, THIGH * sw, SHIN * sw, side, 0);
    const kx = this.sol[0];
    let ky = this.sol[1];
    const endX = this.sol[2];
    let endY = this.sol[3];
    if (lift > 0) {
      // Thigh foreshortens toward horizontal: the knee rises to hip height, the shin keeps hanging.
      const newKy = ky + lift * (hy - ky);
      endY += newKy - ky;
      ky = newKy;
    }
    this.setPt(iKnee, kx, ky, -0.4 * sw * lift);
    this.setPt(iKnee + 2, endX, endY, -0.3 * sw * lift);
    this.setPt(iKnee + 4, endX - side * 0.02 * sw, endY + 0.14 * sw, -0.3 * sw * lift);
    this.setPt(iKnee + 6, endX + side * 0.12 * sw, endY + 0.22 * sw, -0.35 * sw * lift);
  }
}
