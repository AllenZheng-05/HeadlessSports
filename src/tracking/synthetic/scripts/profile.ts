/**
 * Side-on synthetic moves: the player stands in profile to the camera, as a batter or a javelin
 * thrower does. In the image the shoulders overlap (shoulder width near zero), the far arm is
 * barely visible, the wrists travel a short way, a fast wrist blurs (its visibility dips at the
 * speed peak) and a jogging thrower bobs and turns his torso. These are the motions the first
 * recognizers, fitted to the front-on synthetic player, missed on a real camera.
 *
 * Wrist targets are image shoulder widths from the SAME-SIDE shoulder, y up (see `BodyControls`);
 * x is positive toward screen right. `near` is the side of the body toward the camera: positive
 * yaw hides the right side, negative the left.
 *
 * PLACEHOLDER: invented from how people move; replace with recordings (tests/recordings/).
 */
import type { BodyControls } from '../controls';
import type { ScriptStep } from '../script';
import type { Hand } from './moves';

const SIDE_ON = 1.45;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The yaw that puts `near` toward the camera. */
export function sideOnYaw(near: Hand, amount = SIDE_ON): number {
  return near === 'left' ? amount : -amount;
}

function both(x: number, y: number): Partial<BodyControls> {
  return { leftWristX: x, leftWristY: y, rightWristX: x, rightWristY: y };
}

/**
 * Turn side-on and bring both hands to the batting stance. In profile the two shoulders are on top
 * of each other, so both wrists are given the same coordinates from them.
 */
export function turnToStance(opts: {
  near?: Hand;
  direction?: -1 | 1;
  height?: number;
  ms?: number;
}): ScriptStep[] {
  const near = opts.near ?? 'left';
  const dir = opts.direction ?? 1;
  const y = (opts.height ?? -0.35) + 0.1;
  return [
    {
      dur: opts.ms ?? 900,
      to: { yaw: sideOnYaw(near), ...both(-dir * 0.3, y), leftFist: 1, rightFist: 1 },
      label: 'turn',
    },
    { dur: 300, label: 'stance' },
  ];
}

/**
 * A two-handed batting swing seen from the side. The hands load behind the body, sweep through
 * the hitting zone with one speed peak (about 2 x reach / d1 sw/s, 8.5 at the defaults), follow
 * through and settle. The 2D excursion is only `reach` sw because much of the real motion is
 * toward and away from the camera. At the peak both wrists blur (`blur`: the visibility falls to
 * 0.1 there). Start from `turnToStance` (the body is already side-on).
 */
export function sideOnSwing(
  opts: {
    power?: number;
    near?: Hand;
    direction?: -1 | 1;
    height?: number;
    reach?: number;
    blur?: boolean;
    /** Load this much further back (sw) than the default few hundredths: a hitch or a big wind-up. */
    loadBack?: number;
    /** Duration of the load, ms (default 400). */
    loadMs?: number;
  } = {},
): ScriptStep[] {
  const p = clamp01(opts.power ?? 0.6);
  const dir = opts.direction ?? 1;
  const y = opts.height ?? -0.35;
  const reach = opts.reach ?? 0.9;
  const blur = opts.blur ?? true;
  const loadX = -dir * (0.3 + 0.1 * reach + (opts.loadBack ?? 0));
  const midX = loadX + dir * reach;
  const endX = midX + dir * 0.35;
  const d1 = 260 - 80 * p;
  const dip: Partial<BodyControls> = blur ? { leftWristVis: 0.1, rightWristVis: 0.1 } : {};
  const clear: Partial<BodyControls> = blur ? { leftWristVis: 1, rightWristVis: 1 } : {};
  return [
    { dur: opts.loadMs ?? 400, to: both(loadX, y + 0.25), label: 'load' },
    { dur: d1, to: { ...both(midX, y - 0.05), ...dip }, ease: 'in', label: 'swing' },
    { dur: d1 * 0.4, to: { ...both(endX, y + 0.1), ...clear }, ease: 'out', label: 'follow' },
    { dur: 250, label: 'follow' },
    { dur: 500, to: both(-dir * 0.3, y + 0.1), label: 'recover' },
  ];
}

/**
 * A grip adjustment: both hands slide quickly a little way toward the plate (about 2 x travel /
 * ms sw/s at its fastest) and settle back slowly. It is not a swing.
 */
export function gripFlick(opts: {
  direction?: -1 | 1;
  height?: number;
  travel?: number;
  ms?: number;
}): ScriptStep[] {
  const dir = opts.direction ?? 1;
  const y = (opts.height ?? -0.35) + 0.1;
  const travel = opts.travel ?? 0.25;
  return [
    { dur: opts.ms ?? 150, to: both(-dir * 0.3 + dir * travel, y), ease: 'in', label: 'flick' },
    { dur: 500, to: both(-dir * 0.3, y), label: 'flick' },
    { dur: 300, label: 'flick' },
  ];
}

/** The waiting waggle: both hands rock a little back and forth in the stance. */
export function waggle(opts: {
  ms: number;
  amplitude?: number;
  hz?: number;
  direction?: -1 | 1;
  height?: number;
}): ScriptStep[] {
  const dir = opts.direction ?? 1;
  const a = opts.amplitude ?? 0.15;
  const hz = opts.hz ?? 2;
  const y = (opts.height ?? -0.35) + 0.1;
  const half = 500 / hz;
  const out: ScriptStep[] = [];
  for (let t = 0, k = 0; t < opts.ms; t += half, k++) {
    const x = -dir * 0.3 + (k % 2 === 0 ? 1 : -1) * a * dir;
    out.push({ dur: half, to: both(x, y + (k % 2 === 0 ? 0.04 : -0.04)), label: 'waggle' });
  }
  return out;
}

/**
 * Walking into the batter's box: the body turns side-on while it walks (bob, a gentle arm swing,
 * a few steps sideways), the arms hanging. Ends standing side-on, arms at rest.
 */
export function walkIn(
  opts: { near?: Hand; ms?: number; stepsPerSecond?: number } = {},
): ScriptStep[] {
  const near = opts.near ?? 'left';
  const total = opts.ms ?? 1600;
  const sps = opts.stepsPerSecond ?? 1.8;
  const g = 1000 / (sps * 4);
  const out: ScriptStep[] = [];
  const n = Math.max(1, Math.round(total / g));
  for (let k = 1; k <= n; k++) {
    const th = (k * Math.PI) / 4;
    const f = k / n;
    const swing = 0.18 * Math.sin(th);
    out.push({
      dur: g,
      ease: 'linear',
      to: {
        yaw: sideOnYaw(near) * f,
        centreX: 0.42 + 0.08 * f,
        jump: 0.03 * (0.5 - 0.5 * Math.cos(2 * th)),
        leftKnee: 0.15 * Math.max(0, Math.sin(th)),
        rightKnee: 0.15 * Math.max(0, -Math.sin(th)),
        leftWristX: -0.1 + 0.3 * Math.sin(th),
        leftWristY: -1.4 + swing,
        rightWristX: 0.1 - 0.3 * Math.sin(th),
        rightWristY: -1.4 - swing,
      },
      label: 'walk',
    });
  }
  out.push({
    dur: 300,
    to: {
      jump: 0,
      leftKnee: 0,
      rightKnee: 0,
      leftWristX: -0.12,
      leftWristY: -1.4,
      rightWristX: 0.12,
      rightWristY: -1.4,
    },
    label: 'settle',
  });
  return out;
}

export interface JogSideOnOptions {
  /** Jog this long, ms (the throw, if any, is inside it). */
  ms: number;
  /** Throw with this hand at `throwAtMs` into the jog; omit for no throw (both arms pump). */
  throwHand?: Hand;
  throwAtMs?: number;
  /** 0..1 */
  power?: number;
  /** Which side faces the camera. Default: the throwing hand's side, else the left. */
  near?: Hand;
  stepsPerSecond?: number;
  /** Wrist height above the shoulder at the release (sw). Real side-on throws release near the shoulder. */
  releaseY?: number;
  /** Arm pump of the free arm (and of both when nobody throws): swing along x (sw). */
  pump?: number;
  /** Vertical swing of the pumping wrist (sw; default 0.25). A sprint pumps up toward shoulder height. */
  pumpY?: number;
  /** Mean height of the pumping wrist relative to its shoulder (sw; default -0.7). */
  carryY?: number;
  /** Wrist blur at the speed peak. Default true. */
  blur?: boolean;
  /** Turn the torso into the throw (yaw falls by this much over the throw). Default 0.35. */
  turn?: number;
}

/**
 * Jogging on the spot, side-on, the way a javelin thrower does it before the throw: bobbing torso,
 * knees, a pumping free arm, the throwing arm carried back and up. With `throwHand` an overarm
 * throw happens at `throwAtMs`: cock behind the head, whip forward to release near shoulder
 * height (one speed peak, about 11 sw/s at power 1), follow through down, carry on jogging; the
 * torso rotates into the throw and the wrist blurs at the peak. Sampled every ~40 ms.
 */
export function jogSideOn(opts: JogSideOnOptions): ScriptStep[] {
  const throwHand = opts.throwHand;
  const near = opts.near ?? throwHand ?? 'left';
  const sps = opts.stepsPerSecond ?? 3;
  const pump = opts.pump ?? 0.45;
  const pumpY = opts.pumpY ?? 0.25;
  const carryY = opts.carryY ?? -0.7;
  const p = clamp01(opts.power ?? 1);
  const relY = opts.releaseY ?? 0.12;
  const blur = opts.blur ?? true;
  const turn = opts.turn ?? 0.35;
  const throwAt = opts.throwAtMs ?? 1800;
  const g = 1000 / (sps * 6);
  const baseYaw = sideOnYaw(near, 1.3);
  const toward = near === 'left' ? 1 : -1; // yaw sign
  const d1 = 230 - 70 * p;
  const d2 = d1 * 0.7;
  const dir = 1;
  const cockX = -0.85 * dir;
  const cockY = 0.5;
  const relX = 0.5 * dir;
  const endX = 0.95 * dir;
  const endY = -0.65;

  /** Throwing wrist at time t (ms into the jog), and the blur factor. */
  const wristAt = (t: number, out: { x: number; y: number; vis: number; yawAdd: number }): void => {
    const u = t - throwAt;
    out.vis = 1;
    out.yawAdd = 0;
    if (u < 0) {
      // Carried back and up; settles into the cock over the 300 ms before the throw.
      const f = clamp01((u + 300) / 300);
      const sway = 0.04 * Math.sin((t * Math.PI * sps) / 1000);
      out.x = -0.5 * dir + (cockX + 0.5 * dir) * f + sway;
      out.y = 0.25 + (cockY - 0.25) * f;
    } else if (u < d1) {
      const q = u / d1;
      const e = q * q;
      out.x = cockX + (relX - cockX) * e;
      out.y = cockY + (relY - cockY) * e;
      out.vis = blur ? 1 - 0.9 * e : 1;
      out.yawAdd = (-toward * turn * u) / (d1 + d2);
    } else if (u < d1 + d2) {
      const q = (u - d1) / d2;
      const e = 1 - (1 - q) * (1 - q);
      out.x = relX + (endX - relX) * e;
      out.y = relY + (endY - relY) * e;
      out.vis = blur ? 0.1 + 0.9 * e : 1;
      out.yawAdd = (-toward * turn * u) / (d1 + d2);
    } else {
      // Follow through, then back to carrying the arm.
      const f = clamp01((u - d1 - d2) / 500);
      out.x = endX + (-0.2 - endX) * f;
      out.y = endY + (-0.5 - endY) * f;
      out.yawAdd = -toward * turn * (1 - f);
    }
  };

  const w = { x: 0, y: 0, vis: 1, yawAdd: 0 };
  /** The arms, the turn and the blur at time t (ms into the jog). */
  const arms = (t: number): Partial<BodyControls> => {
    const th = (Math.PI * sps * t) / 1000;
    const swing = Math.sin(th + 0.6);
    const to: Partial<BodyControls> = {};
    if (throwHand === undefined) {
      to.leftWristX = 0.2 + pump * swing - 0.1;
      to.leftWristY = carryY + pumpY * swing;
      to.rightWristX = 0.2 - pump * swing - 0.1;
      to.rightWristY = carryY - pumpY * swing;
      return to;
    }
    wristAt(t, w);
    to.yaw = baseYaw + w.yawAdd;
    const freeX = 0.2 + pump * swing - 0.1;
    const freeY = carryY + pumpY * swing;
    if (throwHand === 'right') {
      to.rightWristX = w.x;
      to.rightWristY = w.y;
      to.rightWristVis = w.vis;
      to.leftWristX = freeX;
      to.leftWristY = freeY;
    } else {
      to.leftWristX = w.x;
      to.leftWristY = w.y;
      to.leftWristVis = w.vis;
      to.rightWristX = freeX;
      to.rightWristY = freeY;
    }
    return to;
  };

  const out: ScriptStep[] = [];
  // Get ready: turn and bring the arms to where the jog finds them, so the jog itself starts smoothly.
  out.push({ dur: 500, to: { yaw: baseYaw, ...arms(0) }, label: 'ready' });
  const n = Math.round(opts.ms / g);
  for (let k = 1; k <= n; k++) {
    const t = k * g;
    const th = (Math.PI * sps * t) / 1000;
    const s = Math.sin(th);
    out.push({
      dur: g,
      to: {
        leftKnee: 0.25 * Math.max(0, s),
        rightKnee: 0.25 * Math.max(0, -s),
        jump: 0.07 * (0.5 - 0.5 * Math.cos(2 * th)),
        ...arms(t),
      },
      ease: 'linear',
      label: 'run',
    });
  }
  out.push({
    dur: 300,
    to: {
      leftKnee: 0,
      rightKnee: 0,
      jump: 0,
      leftWristVis: 1,
      rightWristVis: 1,
      leftWristX: -0.12,
      leftWristY: -1.4,
      rightWristX: 0.12,
      rightWristY: -1.4,
    },
    label: 'settle',
  });
  return out;
}
