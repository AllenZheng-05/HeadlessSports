import type { ClimbingConfig } from './config';
import type { HoldField } from './layout';
import { handToWall, wallToHand } from './reach';
import type { Vec2 } from './reach';
import type { ClimbState, HandInput, HandSlot, StepInput } from './rules';

/**
 * The slice of the keyboard-and-mouse provider that click-to-grab needs. `DebugInput` satisfies it;
 * camera input and the synthetic player do not, so they never reach this code.
 */
export interface PointerInput {
  setPointerMode(on: boolean): void;
  readonly pointerClicks: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly selectedHand: 'left' | 'right';
  selectHand(side: 'left' | 'right'): void;
}

export function isPointerInput(input: unknown): input is PointerInput {
  return typeof (input as Partial<PointerInput> | null)?.setPointerMode === 'function';
}

/** A hand the mouse is driving: free (raw input), or in the middle of a click-grab. */
export const FREE = 0;
/** Open for one step so the old hold is let go. */
export const REGRAB = 1;
/** Closed on the chosen hold, waiting for the rules to take it. */
export const CLOSING = 2;
/** Holding; the hand eases to its rest spot and pulls the climber up. */
export const PINNED = 3;

export interface PointerHand {
  phase: number;
  /** Hold being grabbed. */
  target: number;
  closingMs: number;
  /** Eased cursor, metres from the shoulders, while pinned. */
  curX: number;
  curY: number;
}

export interface PointerControl {
  /** 0 left, 1 right: the hand the mouse controls. */
  active: 0 | 1;
  seenClicks: number;
  left: PointerHand;
  right: PointerHand;
}

function createHand(): PointerHand {
  return { phase: FREE, target: -1, closingMs: 0, curX: 0, curY: 0 };
}

export function createPointerControl(): PointerControl {
  return { active: 1, seenClicks: 0, left: createHand(), right: createHand() };
}

const tmp: Vec2 = { x: 0, y: 0 };

/** The hold a click at this image position would take for the active hand, or -1. */
export function pointerTarget(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  px: number,
  py: number,
): number {
  const slot = ctl.active === 0 ? state.left : state.right;
  const other = ctl.active === 0 ? state.right : state.left;
  handToWall(cfg, px, py, tmp);
  return field.findNearest(state.x + tmp.x, state.y + tmp.y, other.hold, slot.hold);
}

/**
 * One click. If it is on a reachable hold the active hand takes that hold (letting go of its old
 * one first, if it has one) and control passes to the other hand. A click that is not on a hold
 * does nothing at all: no hand lets go, and the same hand stays active.
 */
export function pointerClick(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  px: number,
  py: number,
): boolean {
  const mine = ctl.active === 0 ? ctl.left : ctl.right;
  if (mine.phase === REGRAB || mine.phase === CLOSING) return false;
  const i = pointerTarget(ctl, state, cfg, field, px, py);
  if (i < 0) return false;
  const slot = ctl.active === 0 ? state.left : state.right;
  mine.target = i;
  mine.closingMs = 0;
  mine.phase = slot.holding ? REGRAB : CLOSING;
  ctl.active = ctl.active === 0 ? 1 : 0;
  return true;
}

function drive(
  hand: PointerHand,
  slot: HandSlot,
  sign: number,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  out: HandInput,
  dt: number,
): void {
  if (hand.phase === FREE) return;
  if (hand.phase === PINNED) {
    if (!slot.holding) {
      hand.phase = FREE;
      return;
    }
  } else if (hand.phase === CLOSING && slot.holding && slot.hold === hand.target) {
    hand.phase = PINNED;
    hand.curX = slot.cursorX;
    hand.curY = slot.cursorY;
  }
  out.present = true;
  if (hand.phase === PINNED) {
    const a = 1 - Math.exp(-cfg.pointerPullRate * dt);
    hand.curX += (sign * cfg.pointerRestX - hand.curX) * a;
    // Only ever pull down toward the rest spot; a hold below it never drops the climber.
    if (hand.curY > cfg.pointerRestY) hand.curY += (cfg.pointerRestY - hand.curY) * a;
    wallToHand(cfg, hand.curX, hand.curY, tmp);
    out.closed = true;
    out.x = tmp.x;
    out.y = tmp.y;
    return;
  }
  // REGRAB and CLOSING sit exactly on the hold so the rules take that one.
  wallToHand(cfg, field.holdX(hand.target) - state.x, field.holdY(hand.target) - state.y, tmp);
  out.x = tmp.x;
  out.y = tmp.y;
  if (hand.phase === REGRAB) {
    out.closed = false;
    hand.phase = CLOSING;
    hand.closingMs = 0;
  } else {
    out.closed = true;
    hand.closingMs += dt * 1000;
    // The rules give up on a fist after the grab window; so do we.
    if (hand.closingMs > cfg.grabWindowMs + 60) hand.phase = FREE;
  }
}

/** Overwrite the hands this control owns in `input` (raw hand input already copied in). */
export function pointerStep(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  input: StepInput,
  dt: number,
): void {
  drive(ctl.left, state.left, -1, state, cfg, field, input.left, dt);
  drive(ctl.right, state.right, 1, state, cfg, field, input.right, dt);
}
