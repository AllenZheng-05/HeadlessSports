/**
 * Reusable motion primitives for synthetic scripts. Each returns `ScriptStep[]` to splice into a
 * `Script`. Wrist targets are in sw relative to the same-side shoulder, y up (see `BodyControls`).
 *
 * Timing rules: fast actions use an 'in' step (accelerate to the speed peak) followed by an 'out'
 * step of matching speed (decelerate), so the wrist shows one clear, smooth speed peak at the seam.
 * Peak speed of a 2-step action over distance D in time d per step is 2 D / d.
 */
import type { BodyControls } from '../controls';
import type { ScriptStep } from '../script';

export type Hand = 'left' | 'right';

/** Wrist target of a hanging arm. */
const REST_X = 0.12;
const REST_Y = -1.4;

const sign = (hand: Hand): number => (hand === 'right' ? 1 : -1);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEG = Math.PI / 180;

function wrist(hand: Hand, x: number, y: number): Partial<BodyControls> {
  return hand === 'left' ? { leftWristX: x, leftWristY: y } : { rightWristX: x, rightWristY: y };
}

function restWrist(hand: Hand): Partial<BodyControls> {
  return wrist(hand, sign(hand) * REST_X, REST_Y);
}

function fist(hand: Hand, value: number): Partial<BodyControls> {
  return hand === 'left' ? { leftFist: value } : { rightFist: value };
}

export function idle(ms: number): ScriptStep[] {
  return [{ dur: ms, label: 'idle' }];
}

export function closeFist(hand: Hand, ms = 300): ScriptStep[] {
  return [{ dur: ms, to: fist(hand, 1), label: 'closeFist' }];
}

export function openFist(hand: Hand, ms = 300): ScriptStep[] {
  return [{ dur: ms, to: fist(hand, 0), label: 'openFist' }];
}

/** Lift the wrist above head height (slow, 650 ms by default). */
export function armUp(hand: Hand, ms = 650): ScriptStep[] {
  return [{ dur: ms, to: wrist(hand, sign(hand) * 0.35, 1.1), label: 'armUp' }];
}

/**
 * A brisk lift of the arm straight up from hanging to above the head: one speed peak (2 x 1.65 /
 * `ms` * 1000 sw/s, 11 at the default) reached with the wrist already above the shoulder, so it
 * releases like a throw would. It must NOT count as one: its direction is up, not forward.
 */
export function armUpFast(hand: Hand, ms = 300): ScriptStep[] {
  const s = sign(hand);
  return [
    { dur: ms, to: wrist(hand, s * 0.3, 0.25), ease: 'in', label: 'armUpFast' },
    { dur: ms * 0.5, to: wrist(hand, s * 0.35, 1.1), ease: 'out', label: 'armUpFast' },
  ];
}

/** Lower the wrist to the hanging position. */
export function armDown(hand: Hand, ms = 650): ScriptStep[] {
  return [{ dur: ms, to: restWrist(hand), label: 'armDown' }];
}

/** Wrist above head height, hold, lower. With `fist` the hand closes at the top and stays closed. */
export function raiseArm(hand: Hand, opts: { fist?: boolean; holdMs?: number } = {}): ScriptStep[] {
  const steps = [...armUp(hand)];
  if (opts.fist) steps.push(...closeFist(hand));
  steps.push({ dur: opts.holdMs ?? 500, label: 'hold' });
  steps.push(...armDown(hand));
  return steps;
}

/**
 * Bowling: a short back-swing, then one forward-and-up sweep of the wrist whose 2D path is a
 * monotonic diagonal (the arm swings in front of the body, so in a frontal camera view the wrist
 * rises and drifts outward). The 'in' and 'out' halves meet at the single wrist-speed peak (about
 * 7.5 sw/s at power 1), then follow-through, recover. `lateral` shifts the swing line in x (sw);
 * `curve` tilts the sweep direction toward screen right (positive) or left (negative).
 */
export function underarmSwing(
  hand: Hand,
  opts: { power?: number; lateral?: number; curve?: number } = {},
): ScriptStep[] {
  const p = clamp01(opts.power ?? 1);
  const s = sign(hand);
  const lat = opts.lateral ?? 0;
  const backX = -s * 0.1 + lat;
  const backY = -1.2;
  const ux = s * 0.75 + (opts.curve ?? 0) * 0.5;
  const uy = 0.7;
  const un = Math.hypot(ux, uy);
  const total = 0.6 + 0.46 * p;
  const midX = backX + (ux / un) * (total / 2);
  const midY = backY + (uy / un) * (total / 2);
  const endX = backX + (ux / un) * total;
  const endY = backY + (uy / un) * total;
  const d = 250 - 110 * p;
  return [
    { dur: 380, to: wrist(hand, backX, backY), label: 'backswing' },
    { dur: d, to: wrist(hand, midX, midY), ease: 'in', label: 'swing' },
    { dur: d, to: wrist(hand, endX, endY), ease: 'out', label: 'follow' },
    { dur: 250, label: 'follow' },
    { dur: 700, to: restWrist(hand), label: 'recover' },
  ];
}

/**
 * Javelin or pitch: raise and cock the arm back above the shoulder, accelerate forward and down with a
 * single wrist-speed peak (about 10 sw/s at power 1, at the seam between 'throw' and 'follow'),
 * follow through across the body, recover. Higher `loftDeg` releases on a flatter, higher path.
 */
export function overarmThrow(
  hand: Hand,
  opts: { power?: number; loftDeg?: number; lateral?: number } = {},
): ScriptStep[] {
  const p = clamp01(opts.power ?? 1);
  const s = sign(hand);
  const loft = opts.loftDeg ?? 35;
  const cockX = s * 0.6 + (opts.lateral ?? 0);
  const cockY = 0.75;
  const delta = 0.7 + 0.3 * p;
  const d1 = 340 - 140 * p;
  const a1 = (75 - loft) * DEG;
  const relX = cockX - s * Math.cos(a1) * delta;
  const relY = cockY - Math.sin(a1) * delta;
  const a2 = a1 + 25 * DEG;
  const delta2 = 0.7 * delta;
  const endX = relX - s * Math.cos(a2) * delta2;
  const endY = relY - Math.sin(a2) * delta2;
  return [
    { dur: 900, to: wrist(hand, cockX, cockY), label: 'raise' },
    { dur: 200, label: 'cock' },
    { dur: d1, to: wrist(hand, relX, relY), ease: 'in', label: 'throw' },
    { dur: 0.7 * d1, to: wrist(hand, endX, endY), ease: 'out', label: 'follow' },
    { dur: 200, label: 'follow' },
    { dur: 700, to: restWrist(hand), label: 'recover' },
  ];
}

function pair(x: number, y: number): Partial<BodyControls> {
  // Both wrists meet at x (sw from the shoulder midpoint): the shoulders are 1 sw apart.
  return { leftWristX: x + 0.5, leftWristY: y, rightWristX: x - 0.5, rightWristY: y };
}

/**
 * Batting: grip with both fists, load behind, swing across with a single speed peak (about 11 sw/s
 * at power 1), follow through, recover to the stance (fists stay closed).
 * `direction` 1 swings from screen left to right, -1 the other way.
 */
export function twoHandSwing(
  opts: { power?: number; height?: number; direction?: -1 | 1 } = {},
): ScriptStep[] {
  const p = clamp01(opts.power ?? 1);
  const dir = opts.direction ?? 1;
  const y = opts.height ?? -0.35;
  const stance = pair(-dir * 0.2, y + 0.1);
  const loadX = -dir * 0.8;
  const loadY = y + 0.35;
  const midX = dir * 0.1;
  const midY = y - 0.05;
  const len1 = Math.hypot(midX - loadX, midY - loadY);
  const endX = midX + dir * 0.55;
  const endY = midY + 0.2;
  const len2 = Math.hypot(endX - midX, endY - midY);
  const d1 = 260 - 80 * p;
  return [
    { dur: 500, to: { ...stance, leftFist: 1, rightFist: 1 }, label: 'stance' },
    { dur: 400, to: pair(loadX, loadY), label: 'load' },
    { dur: d1, to: pair(midX, midY), ease: 'in', label: 'swing' },
    { dur: (d1 * len2) / len1, to: pair(endX, endY), ease: 'out', label: 'follow' },
    { dur: 200, label: 'follow' },
    { dur: 500, to: stance, label: 'recover' },
  ];
}

/** Alternating knee lifts; one step is one full lift and lower of one knee. */
export function runInPlace(opts: {
  steps: number;
  stepsPerSecond: number;
  amplitude?: number;
}): ScriptStep[] {
  const amp = clamp01(opts.amplitude ?? 0.8);
  const half = 500 / opts.stepsPerSecond;
  const out: ScriptStep[] = [];
  for (let i = 0; i < opts.steps; i++) {
    const left = i % 2 === 0;
    out.push({
      dur: half,
      to: left ? { leftKnee: amp, rightKnee: 0 } : { rightKnee: amp, leftKnee: 0 },
      label: 'run',
    });
    out.push({ dur: half, to: left ? { leftKnee: 0 } : { rightKnee: 0 }, label: 'run' });
  }
  return out;
}

/**
 * A jog on the spot as a front-on camera sees it: small 2D knee displacement (most of the lift is
 * toward the camera), arms pumping in antiphase with the legs, and the whole torso bobbing once
 * per step. Steps alternate left then right. A 250 ms preparation brings the arms to the
 * running position and a 300 ms settle returns to standing, so the motion itself starts and ends
 * cleanly (labelled 'run'; the rest is 'ready' and 'settle').
 *
 * kneeLift: thigh lift as a fraction of horizontal (0 keeps the legs still).
 * armPump: wrist swing amplitude up and down, sw (0 keeps the arms still).
 * bob: torso rise per step, sw (0 turns it off).
 * hold: keep that arm up (the javelin arm) instead of pumping it.
 * startStep: steps already done in this run (a jog continued in a second call keeps its phase and
 * alternation). prep and settle (both default true) drop the 250 ms 'ready' and 300 ms 'settle'
 * parts, for chaining bursts into one run.
 */
export function jogInPlace(opts: {
  steps: number;
  stepsPerSecond: number;
  kneeLift?: number;
  armPump?: number;
  bob?: number;
  hold?: Hand;
  startStep?: number;
  prep?: boolean;
  settle?: boolean;
}): ScriptStep[] {
  const knee = clamp01(opts.kneeLift ?? 0.25);
  const pump = opts.armPump ?? 0.35;
  const bob = opts.bob ?? 0.06;
  const hold = opts.hold;
  const quarter = 250 / opts.stepsPerSecond;
  const carryY = -0.6;
  const armsAt = (leftY: number, rightY: number): Partial<BodyControls> => ({
    leftWristX: hold === 'left' ? -0.35 : -0.3,
    leftWristY: hold === 'left' ? 1.1 : leftY,
    rightWristX: hold === 'right' ? 0.35 : 0.3,
    rightWristY: hold === 'right' ? 1.1 : rightY,
  });
  const out: ScriptStep[] = [];
  if (opts.prep !== false) {
    out.push({ dur: 250, to: armsAt(carryY, carryY), label: 'ready' });
  }
  const k0 = 4 * (opts.startStep ?? 0);
  for (let k = k0 + 1; k <= k0 + 4 * opts.steps; k++) {
    // One stride (left step, right step) is 2 pi of theta; each step is pi.
    const th = (k * Math.PI) / 4;
    const s = Math.sin(th);
    const swing = pump * Math.sin(th + 0.6);
    out.push({
      dur: quarter,
      to: {
        leftKnee: knee * Math.max(0, s),
        rightKnee: knee * Math.max(0, -s),
        jump: bob * (0.5 - 0.5 * Math.cos(2 * th)),
        ...armsAt(carryY + swing, carryY - swing),
      },
      ease: 'linear',
      label: 'run',
    });
  }
  if (opts.settle === false) return out;
  out.push({
    dur: 300,
    to: {
      leftKnee: 0,
      rightKnee: 0,
      jump: 0,
      ...wrist('left', -REST_X, REST_Y),
      ...wrist('right', REST_X, REST_Y),
    },
    label: 'settle',
  });
  return out;
}

export function leanTo(angleRad: number, ms = 400): ScriptStep[] {
  return [{ dur: ms, to: { lean: angleRad }, label: 'lean' }];
}

export function sidestep(toCentreX: number, ms = 400): ScriptStep[] {
  return [{ dur: ms, to: { centreX: toCentreX }, label: 'sidestep' }];
}

/** Down, hold, up. */
export function squat(ms = 900): ScriptStep[] {
  return [
    { dur: ms * 0.4, to: { crouch: 1 }, label: 'squat' },
    { dur: ms * 0.2, label: 'squat' },
    { dur: ms * 0.4, to: { crouch: 0 }, label: 'squat' },
  ];
}

/** Dip, launch, fall, absorb, stand. */
export function jumpUp(ms = 800): ScriptStep[] {
  return [
    { dur: ms * 0.3, to: { crouch: 0.45 }, label: 'jump' },
    { dur: ms * 0.22, to: { crouch: 0, jump: 1.1 }, ease: 'out', label: 'jump' },
    { dur: ms * 0.2, to: { jump: 0 }, ease: 'in', label: 'jump' },
    { dur: ms * 0.12, to: { crouch: 0.3 }, ease: 'out', label: 'jump' },
    { dur: ms * 0.16, to: { crouch: 0 }, label: 'jump' },
  ];
}

/**
 * Archery. The bow arm (opposite of `drawHand`) extends to (aimX, aimY), the draw hand closes, pulls
 * back toward its own shoulder (`draw` 0..1 scales the pull), holds, then opens. The draw hand
 * starts at chest height next to the bow hand.
 */
export function drawBow(
  drawHand: Hand,
  opts: { draw?: number; aimX?: number; aimY?: number; holdMs?: number } = {},
): ScriptStep[] {
  const draw = clamp01(opts.draw ?? 1);
  const sd = sign(drawHand);
  const sb = -sd;
  const bow: Hand = drawHand === 'left' ? 'right' : 'left';
  const aimX = opts.aimX ?? sb * 1.3;
  const aimY = opts.aimY ?? 0.15;
  const startX = sb * 1.4;
  const startY = aimY - 0.05;
  const endX = sd * 0.25;
  const endY = aimY - 0.05;
  return [
    {
      dur: 700,
      to: { ...wrist(bow, aimX, aimY), ...wrist(drawHand, startX, startY) },
      label: 'aim',
    },
    { dur: 300, to: fist(drawHand, 1), label: 'grab' },
    {
      dur: 600 + 400 * draw,
      to: wrist(drawHand, startX + (endX - startX) * draw, startY + (endY - startY) * draw),
      label: 'draw',
    },
    { dur: opts.holdMs ?? 600, label: 'hold' },
    { dur: 300, to: fist(drawHand, 0), label: 'release' },
  ];
}

/** Start block for climbing scripts: hands-only mode, both hands open and visible, body absent. */
export function handsOnlyStart(): Partial<BodyControls> {
  return {
    handsOnly: 1,
    bodyVisible: 0,
    shoulderWidth: 0,
    leftHandVisible: 1,
    rightHandVisible: 1,
    leftFist: 0,
    rightFist: 0,
    leftHandX: 0.38,
    leftHandY: 0.6,
    rightHandX: 0.62,
    rightHandY: 0.6,
    handSize: 0.16,
  };
}

/**
 * Open hand moves to (reachX, reachY) in mirrored normalised coordinates, closes, then pulls down by
 * `pullBy` (normalised y grows downward, so positive pulls down) and stays closed.
 */
export function climbPull(
  hand: Hand,
  opts: { reachX: number; reachY: number; pullBy: number; ms?: number },
): ScriptStep[] {
  const left = hand === 'left';
  const at = (x: number, y: number, f?: number): Partial<BodyControls> => {
    const f2 = f === undefined ? {} : fist(hand, f);
    return left ? { leftHandX: x, leftHandY: y, ...f2 } : { rightHandX: x, rightHandY: y, ...f2 };
  };
  return [
    { dur: 450, to: at(opts.reachX, opts.reachY, 0), label: 'reach' },
    { dur: 150, label: 'settle' },
    { dur: 300, to: fist(hand, 1), label: 'grab' },
    { dur: opts.ms ?? 500, to: at(opts.reachX, opts.reachY + opts.pullBy), label: 'pull' },
  ];
}
