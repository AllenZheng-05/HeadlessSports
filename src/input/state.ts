import { POSE_COUNT, POSE_STRIDE } from '../tracking/types';
import type { ArmState, HandState, InputState } from './types';

export function createHandState(): HandState {
  return { present: false, known: false, closed: false, curl: 0, x: 0, y: 0, vx: 0, vy: 0 };
}

export function createArmState(): ArmState {
  return { vx: 0, vy: 0, speed: 0, elbowAngle: Math.PI, elbowRate: 0, wristX: 0, wristY: 0 };
}

export function createInputState(): InputState {
  return {
    t: 0,
    tPrev: 0,
    tracking: false,
    problem: 'lost',
    aspect: 16 / 9,
    pose: new Float32Array(POSE_COUNT * POSE_STRIDE),
    posePrev: new Float32Array(POSE_COUNT * POSE_STRIDE),
    hasPose: false,
    shoulderWidth: 0,
    hands: { left: createHandState(), right: createHandState() },
    arms: { left: createArmState(), right: createArmState() },
    lean: 0,
    lateral: 0,
    rise: 0,
    cadence: { stepsPerSecond: 0, amplitude: 0 },
  };
}

function resetHand(h: HandState): void {
  h.present = false;
  h.known = false;
  h.closed = false;
  h.curl = 0;
  h.x = 0;
  h.y = 0;
  h.vx = 0;
  h.vy = 0;
}

function resetArm(a: ArmState): void {
  a.vx = 0;
  a.vy = 0;
  a.speed = 0;
  a.elbowAngle = Math.PI;
  a.elbowRate = 0;
  a.wristX = 0;
  a.wristY = 0;
}

/** Back to the freshly created values, in place. */
export function resetInputState(state: InputState): void {
  state.t = 0;
  state.tPrev = 0;
  state.tracking = false;
  state.problem = 'lost';
  state.aspect = 16 / 9;
  state.pose.fill(0);
  state.posePrev.fill(0);
  state.hasPose = false;
  state.shoulderWidth = 0;
  resetHand(state.hands.left);
  resetHand(state.hands.right);
  resetArm(state.arms.left);
  resetArm(state.arms.right);
  state.lean = 0;
  state.lateral = 0;
  state.rise = 0;
  state.cadence.stepsPerSecond = 0;
  state.cadence.amplitude = 0;
}
