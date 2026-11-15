import type { ClimbingConfig } from './config';
import type { HoldField } from './layout';
import { handToWall, wallToHand } from './reach';
import type { Vec2 } from './reach';
import { shoulderDrop } from './rules';
import type { ClimbState, HandInput, HandSlot, StepInput } from './rules';

/**
 * Mouse-only climbing. One hand is selected. Pressing on a hold grabs it with that hand (letting go
 * of its old hold first); while the button stays down the hand is locked on the hold and moving the
 * mouse drags the climber (a pull-up on that hand). Releasing keeps the grip and passes control to
 * the other hand. A press that is not on a hold does nothing.
 *
 * The hands are fed to the normal rules as hand input, so the body still comes from the held hands.
 */

/** Nothing special: free, or just holding. */
export const FREE = 0;
/** Open for one step so the old hold is let go. */
export const REGRAB = 1;
/** Closed on the chosen hold, waiting for the rules to take it. */
export const CLOSING = 2;
/** Holding the chosen hold. */
export const HELD = 3;

export interface PointerHand {
  phase: number;
  /** Hold being grabbed or held. */
  target: number;
  closingMs: number;
}

export interface PointerControl {
  /** 0 left, 1 right: the hand the mouse controls. */
  active: 0 | 1;
  /** True from a press that found a hold to the matching release. */
  dragging: boolean;
  seenPresses: number;
  seenReleases: number;
  /** Where the body is being dragged to (shoulder centre, world metres), while dragging. */
  bodyX: number;
  bodyY: number;
  lastPX: number;
  lastPY: number;
  left: PointerHand;
  right: PointerHand;
}

function createHand(): PointerHand {
  return { phase: FREE, target: -1, closingMs: 0 };
}

export function createPointerControl(): PointerControl {
  return {
    active: 1,
    dragging: false,
    seenPresses: 0,
    seenReleases: 0,
    bodyX: 0,
    bodyY: 0,
    lastPX: 0,
    lastPY: 0,
    left: createHand(),
    right: createHand(),
  };
}

const tmp: Vec2 = { x: 0, y: 0 };

/** The hold a press at this image position would take for the active hand, or -1. */
export function pointerTarget(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  px: number,
  py: number,
): number {
  const other = ctl.active === 0 ? state.right : state.left;
  handToWall(cfg, px, py, tmp);
  return field.findNearest(state.x + tmp.x, state.y + tmp.y, other.hold, -1);
}

/**
 * The button went down. On a reachable hold the active hand takes it (letting go of its old one) and
 * the drag starts; otherwise nothing at all happens.
 */
export function pointerPress(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  px: number,
  py: number,
): boolean {
  if (ctl.dragging) return false;
  const i = pointerTarget(ctl, state, cfg, field, px, py);
  if (i < 0) return false;
  const mine = ctl.active === 0 ? ctl.left : ctl.right;
  const slot = ctl.active === 0 ? state.left : state.right;
  mine.target = i;
  mine.closingMs = 0;
  if (slot.holding && slot.hold === i) mine.phase = HELD;
  else mine.phase = slot.holding ? REGRAB : CLOSING;
  ctl.dragging = true;
  ctl.bodyX = state.x;
  ctl.bodyY = state.y;
  ctl.lastPX = px;
  ctl.lastPY = py;
  return true;
}

/** The button went up. If a drag was going the grip stays and control passes to the other hand. */
export function pointerRelease(ctl: PointerControl): boolean {
  if (!ctl.dragging) return false;
  ctl.dragging = false;
  ctl.active = ctl.active === 0 ? 1 : 0;
  return true;
}

/** Keep the body where both held hands can still reach their holds (the reach box). */
function clampBody(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  drop: number,
): void {
  const hw = cfg.reachWidth / 2;
  const hh = cfg.reachHeight / 2;
  for (let k = 0; k < 2; k++) {
    const slot = k === 0 ? state.left : state.right;
    if (!slot.holding) continue;
    const hx = field.holdX(slot.hold);
    const hy = field.holdY(slot.hold) - cfg.reachOffsetY;
    // Never tighter than where the body is now, so a grab at the edge does not snap.
    const lx = Math.max(1, Math.abs(hx - state.x) / hw) * hw;
    const ly = Math.max(1, Math.abs(hy - state.y) / hh) * hh;
    if (ctl.bodyX > hx + lx) ctl.bodyX = hx + lx;
    else if (ctl.bodyX < hx - lx) ctl.bodyX = hx - lx;
    if (ctl.bodyY > hy + ly) ctl.bodyY = hy + ly;
    else if (ctl.bodyY < hy - ly) ctl.bodyY = hy - ly;
  }
  if (ctl.bodyX > cfg.wallHalfWidth) ctl.bodyX = cfg.wallHalfWidth;
  else if (ctl.bodyX < -cfg.wallHalfWidth) ctl.bodyX = -cfg.wallHalfWidth;
  if (ctl.bodyY < drop) ctl.bodyY = drop;
}

function setFromWall(
  cfg: ClimbingConfig,
  wallX: number,
  wallY: number,
  closed: boolean,
  out: HandInput,
): void {
  wallToHand(cfg, wallX, wallY, tmp);
  out.present = true;
  out.closed = closed;
  out.x = tmp.x;
  out.y = tmp.y;
}

function drive(
  ctl: PointerControl,
  idx: 0 | 1,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  out: HandInput,
  px: number,
  py: number,
  bx: number,
  by: number,
  dt: number,
): void {
  const hand = idx === 0 ? ctl.left : ctl.right;
  const slot: HandSlot = idx === 0 ? state.left : state.right;
  if (hand.phase === HELD && !slot.holding) hand.phase = FREE;
  if (hand.phase === CLOSING && slot.holding) {
    // Whatever the rules took counts, even if a neighbouring hold won.
    hand.target = slot.hold;
    hand.phase = HELD;
  }

  if (hand.phase === REGRAB || hand.phase === CLOSING) {
    // Sit exactly on the chosen hold so the rules take that one.
    setFromWall(
      cfg,
      field.holdX(hand.target) - state.x,
      field.holdY(hand.target) - state.y,
      hand.phase === CLOSING,
      out,
    );
    if (hand.phase === REGRAB) {
      hand.phase = CLOSING;
      hand.closingMs = 0;
    } else {
      hand.closingMs += dt * 1000;
      // The rules give up on a fist after the grab window; so do we.
      if (hand.closingMs > cfg.grabWindowMs + 60) {
        hand.phase = FREE;
        // The grab did not take (for example no stamina): the press counts as nothing.
        if (ctl.active === idx) ctl.dragging = false;
      }
    }
    return;
  }
  if (slot.holding) {
    // Gripping: the hand stays on its hold, placed so the body sits at (bx, by).
    setFromWall(cfg, field.holdX(slot.hold) - bx, field.holdY(slot.hold) - by, true, out);
    return;
  }
  if (ctl.active === idx) {
    // The free hand follows the mouse, open.
    out.present = true;
    out.closed = false;
    out.x = px;
    out.y = py;
    return;
  }
  // The idle empty hand stays where it is.
  setFromWall(cfg, slot.cursorX, slot.cursorY, false, out);
}

/**
 * Fill both hands of `input` from the mouse state for this step. While dragging, the body target
 * moves by the pointer's displacement (down pulls the body up; right moves the body left, as when
 * dragging the wall), limited by the reach of every held hand.
 */
export function pointerStep(
  ctl: PointerControl,
  state: ClimbState,
  cfg: ClimbingConfig,
  field: HoldField,
  input: StepInput,
  px: number,
  py: number,
  dt: number,
): void {
  const mine = ctl.active === 0 ? ctl.left : ctl.right;
  const mySlot = ctl.active === 0 ? state.left : state.right;
  let bx = state.x;
  let by = state.y;
  if (ctl.dragging && mine.phase === HELD && mySlot.holding) {
    ctl.bodyX -= (px - ctl.lastPX) * cfg.reachWidth;
    ctl.bodyY += (py - ctl.lastPY) * cfg.reachHeight;
    clampBody(ctl, state, cfg, field, shoulderDrop(cfg));
    bx = ctl.bodyX;
    by = ctl.bodyY;
  } else if (ctl.dragging) {
    // Waiting for the grab: nothing moves yet.
    ctl.bodyX = state.x;
    ctl.bodyY = state.y;
  }
  ctl.lastPX = px;
  ctl.lastPY = py;
  drive(ctl, 0, state, cfg, field, input.left, px, py, bx, by, dt);
  drive(ctl, 1, state, cfg, field, input.right, px, py, bx, by, dt);
}
