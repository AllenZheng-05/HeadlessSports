import type { ClimbingConfig } from './config';
import { KIND_CRIMP } from './layout';
import type { HoldField } from './layout';

/** Rig shoulder height at scale 1 (AvatarRig dimensions.shoulderHeight). */
export const RIG_SHOULDER_HEIGHT = 1.3;

export type Status = 'ready' | 'climbing' | 'timeout' | 'fell';
export type EndReason = 'none' | 'time' | 'slip' | 'stamina';
export type ReleaseKind = 'none' | 'open' | 'lost' | 'reach' | 'stamina';

/** One hand's input for a step. Filled in place by the sport each fixed step. */
export interface HandInput {
  present: boolean;
  closed: boolean;
  /** Mirrored normalised image position, y down. */
  x: number;
  y: number;
}
export interface StepInput {
  left: HandInput;
  right: HandInput;
}
export function createStepInput(): StepInput {
  return {
    left: { present: true, closed: false, x: 0.4, y: 0.6 },
    right: { present: true, closed: false, x: 0.6, y: 0.6 },
  };
}

export interface HandSlot {
  closed: boolean;
  /** Cursor on the wall, metres from the shoulder centre. Kept while the hand is lost. */
  cursorX: number;
  cursorY: number;
  holding: boolean;
  /** Hold index, -1 when not holding. */
  hold: number;
  lostMs: number;
  /** Remaining ms in which a fresh fist may still grab. */
  windowMs: number;
}

export interface ClimbState {
  status: Status;
  endReason: EndReason;
  /** Shoulder centre, world metres. */
  x: number;
  y: number;
  /** Where the held hands say the climber should be (valid while any hand holds). */
  targetX: number;
  targetY: number;
  speed: number;
  stamina: number;
  /** Seconds since the first grab, and the round length. */
  elapsed: number;
  roundSeconds: number;
  /** Best height of the shoulders above the start, metres. */
  best: number;
  slipMs: number;
  fallVy: number;
  standing: boolean;
  left: HandSlot;
  right: HandSlot;
  grabs: number;
  crimpGrabs: number;
  falls: number;
  /** Event counters; the sport compares them with its own to react once. */
  grabSeq: number;
  lastGrabSide: 0 | 1;
  releaseSeq: number;
  lastRelease: ReleaseKind;
  /** Scales the one-hand stamina drain (mouse play grips with one hand at a time). */
  oneHandDrainMult: number;
}

/** Distance from the shoulder centre down to the feet. */
export function shoulderDrop(cfg: Pick<ClimbingConfig, 'avatarScale'>): number {
  return RIG_SHOULDER_HEIGHT * cfg.avatarScale;
}

function createSlot(): HandSlot {
  return {
    closed: false,
    cursorX: 0,
    cursorY: 0,
    holding: false,
    hold: -1,
    lostMs: 0,
    windowMs: 0,
  };
}

export function createClimbState(cfg: ClimbingConfig, roundSeconds: number): ClimbState {
  return {
    status: 'ready',
    endReason: 'none',
    x: 0,
    y: shoulderDrop(cfg),
    targetX: 0,
    targetY: shoulderDrop(cfg),
    speed: 0,
    stamina: 1,
    elapsed: 0,
    roundSeconds,
    best: 0,
    slipMs: 0,
    fallVy: 0,
    standing: true,
    left: createSlot(),
    right: createSlot(),
    grabs: 0,
    crimpGrabs: 0,
    falls: 0,
    grabSeq: 0,
    lastGrabSide: 0,
    releaseSeq: 0,
    lastRelease: 'none',
    oneHandDrainMult: 1,
  };
}

/** Height of the feet above the ground. */
export function heightOf(state: ClimbState, cfg: Pick<ClimbingConfig, 'avatarScale'>): number {
  return state.y - shoulderDrop(cfg);
}

export function isDone(state: ClimbState): boolean {
  return state.status === 'timeout' || state.status === 'fell';
}

function release(state: ClimbState, slot: HandSlot, kind: ReleaseKind): void {
  slot.holding = false;
  slot.hold = -1;
  state.releaseSeq++;
  state.lastRelease = kind;
}

function updateHand(
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  slot: HandSlot,
  other: HandSlot,
  input: HandInput,
  side: 0 | 1,
  ms: number,
): void {
  if (input.present) {
    slot.cursorX = (input.x - 0.5) * cfg.reachWidth;
    slot.cursorY = (0.5 - input.y) * cfg.reachHeight + cfg.reachOffsetY;
    slot.lostMs = 0;
  } else {
    slot.lostMs += ms;
  }

  if (input.closed && !slot.closed) slot.windowMs = cfg.grabWindowMs;
  if (!input.closed) {
    slot.windowMs = 0;
    if (slot.holding) release(state, slot, 'open');
  }
  slot.closed = input.closed;

  if (slot.holding) {
    if (slot.lostMs > cfg.lostHandGraceMs) {
      release(state, slot, 'lost');
    } else {
      const ux = (field.holdX(slot.hold) - state.x) / (cfg.reachWidth / 2);
      const uy = (field.holdY(slot.hold) - state.y - cfg.reachOffsetY) / (cfg.reachHeight / 2);
      if (Math.abs(ux) > cfg.reachSlack || Math.abs(uy) > cfg.reachSlack) {
        release(state, slot, 'reach');
        slot.windowMs = 0;
      }
    }
    return;
  }

  if (slot.windowMs > 0) {
    slot.windowMs -= ms;
    if (input.present && slot.closed && state.stamina >= cfg.minGrabStamina) {
      const i = field.findNearest(state.x + slot.cursorX, state.y + slot.cursorY, other.hold, -1);
      if (i >= 0) {
        slot.holding = true;
        slot.hold = i;
        slot.windowMs = 0;
        state.grabs++;
        if (field.holdKind(i) === KIND_CRIMP) state.crimpGrabs++;
        state.grabSeq++;
        state.lastGrabSide = side;
        if (state.status === 'ready') state.status = 'climbing';
      }
    }
  }
}

/**
 * One fixed step of the climbing rules. Pure state in, state out; no allocation.
 * Hands solve the climber's position: a held hold stays under its hand.
 */
export function step(
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  input: StepInput,
  dt: number,
): void {
  if (state.status === 'timeout') return;
  const drop = shoulderDrop(cfg);
  if (state.status === 'fell') {
    state.fallVy += cfg.gravity * dt;
    state.y = Math.max(drop, state.y - state.fallVy * dt);
    return;
  }

  const ms = dt * 1000;
  updateHand(state, cfg, field, state.left, state.right, input.left, 0, ms);
  updateHand(state, cfg, field, state.right, state.left, input.right, 1, ms);

  // Solve the climber's position from the holding hands.
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  if (state.left.holding) {
    n++;
    sumX += field.holdX(state.left.hold) - state.left.cursorX;
    sumY += field.holdY(state.left.hold) - state.left.cursorY;
  }
  if (state.right.holding) {
    n++;
    sumX += field.holdX(state.right.hold) - state.right.cursorX;
    sumY += field.holdY(state.right.hold) - state.right.cursorY;
  }
  let moved = 0;
  if (n > 0) {
    let tx = sumX / n;
    let ty = sumY / n;
    if (tx > cfg.wallHalfWidth) tx = cfg.wallHalfWidth;
    else if (tx < -cfg.wallHalfWidth) tx = -cfg.wallHalfWidth;
    if (ty < drop) ty = drop;
    state.targetX = tx;
    state.targetY = ty;
    const a = 1 - Math.exp(-cfg.followRate * dt);
    let mx = (tx - state.x) * a;
    let my = (ty - state.y) * a;
    const len = Math.sqrt(mx * mx + my * my);
    const limit = cfg.maxClimbSpeed * dt;
    if (len > limit) {
      mx *= limit / len;
      my *= limit / len;
    }
    state.x += mx;
    state.y += my;
    moved = Math.sqrt(mx * mx + my * my) / dt;
  }
  state.speed = moved;
  if (state.y < drop) state.y = drop;

  const level = field.standLevel(state.y - drop);
  state.standing = level >= 0;
  if (n === 0 && state.standing) {
    // Standing needs no hands; settle onto the ledge.
    state.y = level + drop;
  }

  if (state.status === 'climbing') {
    // Stamina.
    if (state.standing) {
      state.stamina += cfg.ledgeRefillPerSecond * dt;
    } else if (n === 2) {
      if (
        state.speed < 0.05 &&
        field.holdKind(state.left.hold) !== KIND_CRIMP &&
        field.holdKind(state.right.hold) !== KIND_CRIMP
      ) {
        state.stamina += cfg.restRefillPerSecond * dt;
      } else {
        state.stamina -= cfg.drainTwoHands * dt;
      }
    } else if (n === 1) {
      const hold = state.left.holding ? state.left.hold : state.right.hold;
      const mult = field.holdKind(hold) === KIND_CRIMP ? cfg.crimpDrainMult : 1;
      state.stamina -= cfg.drainOneHand * mult * state.oneHandDrainMult * dt;
    }
    if (state.stamina > 1) state.stamina = 1;
    if (state.stamina <= 0) {
      state.stamina = 0;
      if (n > 0) {
        if (state.left.holding) release(state, state.left, 'stamina');
        if (state.right.holding) release(state, state.right, 'stamina');
        n = 0;
      }
    }

    // Slip: nothing holds and nothing is underfoot.
    if (n > 0 || state.standing) {
      state.slipMs = 0;
    } else {
      state.slipMs += ms;
      if (state.slipMs >= cfg.slipGraceMs) {
        state.status = 'fell';
        state.endReason = state.stamina <= 0 ? 'stamina' : 'slip';
        state.falls++;
        state.fallVy = 0;
        return;
      }
    }

    state.elapsed += dt;
    if (state.elapsed >= state.roundSeconds) {
      state.status = 'timeout';
      state.endReason = 'time';
    }
  }

  const h = state.y - drop;
  if (h > state.best) state.best = h;
}
