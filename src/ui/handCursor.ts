import type { InputState, Side } from '../input/types';
import { PoseIndex, POSE_STRIDE } from '../tracking/types';
import { clamp, h, svgEl, uiScale } from './dom';
import { pctTenth } from './format';

/** A fist must stay closed over the button this long before it selects, ms. Rides out a misread frame. */
export const FIST_CONFIRM_MS = 250;
/** After a selection nothing else can be chosen for this long, ms. */
export const LOCKOUT_MS = 600;
/** After a new screen appears the cursor cannot select for this long, ms. */
export const SCREEN_GUARD_MS = 1200;
/** Extra hit area around each button, px. */
export const FORGIVENESS_PX = 12;
/** In reveal-near mode the mitt only shows when the hand is this close to a button, px. */
export const REVEAL_PX = 140;
const SMOOTH_TIME_S = 0.08;
const VISIBILITY_MIN = 0.5;

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Map a hand position to the screen (0..1) through a comfortable reach box so the player never
 * has to reach the camera's edges. With a pose the box is anchored on the shoulders; with
 * hands-only tracking the palm is used directly, expanded about the centre by 1.3.
 */
export function mapReach(
  out: Point2,
  hasPose: boolean,
  aspect: number,
  shoulderWidth: number,
  shoulderMidX: number,
  shoulderMidY: number,
  handX: number,
  handY: number,
): void {
  if (hasPose && shoulderWidth > 0) {
    out.x = clamp(0.5 + ((handX - shoulderMidX) * aspect) / (shoulderWidth * 3.0), 0, 1);
    out.y = clamp(0.5 - ((shoulderMidY - handY) / shoulderWidth - 0.2) / 2.2, 0, 1);
  } else {
    out.x = clamp(0.5 + (handX - 0.5) * 1.3, 0, 1);
    out.y = clamp(0.5 + (handY - 0.5) * 1.3, 0, 1);
  }
}

/** What the classifier says about one hand this frame. */
export type FistState = 'open' | 'closed' | 'unknown';

/**
 * Fist-to-select over a list of targets. Pure: feed it the hovered index (-1 when none or not
 * armed) and the hand's fist state each frame. A selection needs the hand seen open over a
 * button, then closed over that same button for FIST_CONFIRM_MS. It fires once; the hand must
 * open over a button again before the next one. A fist that arrives already closed, or an
 * unknown state, never selects.
 */
export class FistTracker {
  /** Button index being hovered, or -1. */
  target = -1;
  /** 0..1 progress of the fist confirm. */
  progress = 0;
  /** The button the hand was last seen open over, or -1. */
  private openOn = -1;
  private closedSince = -1;
  private lockedUntil = -Infinity;

  constructor(
    readonly confirmMs = FIST_CONFIRM_MS,
    readonly lockoutMs = LOCKOUT_MS,
  ) {}

  reset(): void {
    this.target = -1;
    this.progress = 0;
    this.openOn = -1;
    this.closedSince = -1;
  }

  /** Drop everything, and ignore the buttons for the lockout time (a selection just happened). */
  lock(nowMs: number): void {
    this.reset();
    this.lockedUntil = nowMs + this.lockoutMs;
  }

  /** Returns the index that was just selected, or -1. */
  update(hovered: number, fist: FistState, nowMs: number): number {
    if (nowMs < this.lockedUntil || hovered < 0) {
      this.reset();
      return -1;
    }
    this.target = hovered;
    if (fist === 'open') {
      this.openOn = hovered;
      this.closedSince = -1;
      this.progress = 0;
      return -1;
    }
    if (fist === 'unknown') {
      this.openOn = -1;
      this.closedSince = -1;
      this.progress = 0;
      return -1;
    }
    // closed
    if (this.openOn !== hovered) {
      this.closedSince = -1;
      this.progress = 0;
      return -1;
    }
    if (this.closedSince < 0) this.closedSince = nowMs;
    this.progress = Math.min(1, (nowMs - this.closedSince) / this.confirmMs);
    if (this.progress < 1) return -1;
    this.lockedUntil = nowMs + this.lockoutMs;
    this.reset();
    return hovered;
  }
}

/** Critically damped smoothing (Unity-style SmoothDamp), state kept in the object. */
export class SmoothPoint {
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;

  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
  }

  step(tx: number, ty: number, dt: number, smoothTime = SMOOTH_TIME_S): void {
    const omega = 2 / smoothTime;
    const k = omega * dt;
    const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    let cx = this.x - tx;
    const tempX = (this.vx + omega * cx) * dt;
    this.vx = (this.vx - omega * tempX) * e;
    this.x = tx + (cx + tempX) * e;
    cx = this.y - ty;
    const tempY = (this.vy + omega * cx) * dt;
    this.vy = (this.vy - omega * tempY) * e;
    this.y = ty + (cx + tempY) * e;
  }
}

/** Index of the first rect (x, y, w, h packed) containing the point with margin, or -1. */
export function hitTest(
  rects: Float32Array,
  count: number,
  px: number,
  py: number,
  margin: number,
): number {
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = rects[o] as number;
    const y = rects[o + 1] as number;
    const w = rects[o + 2] as number;
    const hh = rects[o + 3] as number;
    if (px >= x - margin && px <= x + w + margin && py >= y - margin && py <= y + hh + margin) {
      return i;
    }
  }
  return -1;
}

const RING_R = 38;
const RING_LEN = 2 * Math.PI * RING_R;
const RING_OFFSETS: readonly string[] = Array.from({ length: 101 }, (_, i) =>
  (RING_LEN * (1 - i / 100)).toFixed(1),
);

/** What a cursor needs to know about the screen and the player each frame. */
interface SlotFrame {
  rects: Float32Array;
  count: number;
  revealNear: boolean;
  guardOver: boolean;
  usePose: boolean;
  shoulderX: number;
  shoulderY: number;
  dt: number;
}

/**
 * One cursor: it follows exactly one hand (left or right), with its own smoothing, hover and
 * fist-select state and its own ring. Everything it needs is allocated up front.
 */
class CursorSlot {
  readonly el: HTMLElement;
  readonly fist = new FistTracker();
  /** Button index this cursor is hovering (the fist tracker's target), or -1. */
  hovered = -1;
  /** The hand is tracked and the mitt is on screen (not hidden by reveal-near). */
  active = false;
  /** The hand's fist state this frame. */
  fistState: FistState = 'unknown';
  /** Button index under the mitt this frame, or -1. */
  hit = -1;
  /** The hand has been outside every button (or absent for the guard time) on this screen. */
  seenOutside = false;
  private readonly ring: SVGCircleElement;
  private shown = false;
  private closed = false;
  private lastRing = -1;
  private lastX = -1;
  private lastY = -1;
  /** The smoothed position has been seeded since the hand last went away. */
  private tracking = false;
  private readonly target: Point2 = { x: 0.5, y: 0.5 };
  private readonly smooth = new SmoothPoint();

  constructor(
    parent: HTMLElement,
    readonly side: Side,
  ) {
    this.el = h('div', `hand-cursor hc-${side}`);
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    const svg = svgEl('svg', { viewBox: '0 0 100 100', width: 84, height: 84 });
    svg.append(
      svgEl('circle', {
        class: 'hc-ring-bg',
        cx: 50,
        cy: 50,
        r: RING_R,
        fill: 'none',
        'stroke-width': 8,
      }),
    );
    this.ring = svgEl('circle', {
      class: 'hc-ring',
      cx: 50,
      cy: 50,
      r: RING_R,
      fill: 'none',
      'stroke-width': 8,
      'stroke-linecap': 'round',
      'stroke-dasharray': RING_LEN.toFixed(1),
      'stroke-dashoffset': RING_LEN.toFixed(1),
      transform: 'rotate(-90 50 50)',
    });
    svg.append(this.ring);
    const mitt = h('div', 'hc-mitt');
    const tag = h('span', 'hc-tag', side === 'left' ? 'L' : 'R');
    this.el.append(svg, mitt, tag);
    parent.append(this.el);
  }

  get isShown(): boolean {
    return this.shown;
  }

  showEl(): void {
    if (!this.shown) {
      this.shown = true;
      this.el.hidden = false;
    }
  }

  hideEl(): void {
    if (this.shown) {
      this.shown = false;
      this.el.hidden = true;
    }
  }

  /** Fully off: hidden, forgotten position, no hold. */
  hide(): void {
    this.tracking = false;
    this.active = false;
    this.hit = -1;
    this.lastX = -1;
    this.lastY = -1;
    this.hideEl();
    this.fist.reset();
    this.setRing(0);
  }

  /** A new screen, resume from play or reveal-near change: nothing is held, the guard restarts. */
  rearm(): void {
    this.fist.reset();
    this.seenOutside = false;
  }

  setRing(progress: number): void {
    const i = Math.round(progress * 100);
    if (i === this.lastRing) return;
    this.lastRing = i;
    this.ring.setAttribute('stroke-dashoffset', RING_OFFSETS[i] as string);
  }

  /** Another cursor selected: drop this one's hold and apply the post-selection lockout. */
  cancel(nowMs: number): void {
    this.fist.lock(nowMs);
    this.setRing(0);
  }

  /** Move to this slot's hand for one frame. Allocation free. */
  place(state: InputState, f: SlotFrame): void {
    const hand = this.side === 'left' ? state.hands.left : state.hands.right;
    this.fistState = hand.present && hand.known ? (hand.closed ? 'closed' : 'open') : 'unknown';
    let ok = false;
    let hx = 0;
    let hy = 0;
    if (hand.present) {
      ok = true;
      hx = hand.x;
      hy = hand.y;
    } else if (state.hasPose) {
      const o = (this.side === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST) * POSE_STRIDE;
      if ((state.pose[o + 3] as number) >= VISIBILITY_MIN) {
        ok = true;
        hx = state.pose[o] as number;
        hy = state.pose[o + 1] as number;
      }
    }
    if (!ok) {
      if (f.guardOver) this.seenOutside = true; // hand lowered or out of view for the whole guard
      this.hide();
      return;
    }
    mapReach(
      this.target,
      f.usePose,
      state.aspect,
      state.shoulderWidth,
      f.shoulderX,
      f.shoulderY,
      hx,
      hy,
    );
    if (!this.tracking) {
      this.tracking = true;
      this.smooth.snap(this.target.x, this.target.y);
    } else {
      this.smooth.step(this.target.x, this.target.y, f.dt > 0 ? f.dt : 1 / 60);
    }
    const sx = this.smooth.x;
    const sy = this.smooth.y;
    if (f.revealNear) {
      const near = hitTest(
        f.rects,
        f.count,
        sx * window.innerWidth,
        sy * window.innerHeight,
        REVEAL_PX * uiScale(),
      );
      if (near < 0) {
        this.hideEl();
        this.active = false;
        this.hit = -1;
        this.fist.reset();
        this.setRing(0);
        return;
      }
    }
    this.showEl();
    const qx = Math.round(sx * 1000);
    const qy = Math.round(sy * 1000);
    if (qx !== this.lastX) {
      this.lastX = qx;
      this.el.style.left = pctTenth(sx);
    }
    if (qy !== this.lastY) {
      this.lastY = qy;
      this.el.style.top = pctTenth(sy);
    }
    this.setClosed(hand.present && hand.known && hand.closed);
    this.hit = hitTest(
      f.rects,
      f.count,
      sx * window.innerWidth,
      sy * window.innerHeight,
      FORGIVENESS_PX * uiScale(),
    );
    if (this.hit < 0) this.seenOutside = true;
    this.active = true;
  }

  /** Advance the fist select. Returns the selected button index, or -1. */
  fistStep(guardOver: boolean, nowMs: number): number {
    // A hand resting where a button appears must not select it.
    const done = this.fist.update(
      this.active && guardOver && this.seenOutside ? this.hit : -1,
      this.fistState,
      nowMs,
    );
    this.setRing(this.fist.progress);
    return done;
  }

  setClosed(closed: boolean): void {
    if (closed === this.closed) return;
    this.closed = closed;
    this.el.classList.toggle('closed', closed);
  }

  dispose(): void {
    this.el.remove();
  }
}

/**
 * The on-screen mitts that follow the player's hands and select buttons with a fist.
 * In camera mode each tracked hand has its own cursor (left and right, equal, never swapping).
 * In mouse mode there is one cursor, on the pointer (the right element).
 */
export class HandCursor {
  private readonly left: CursorSlot;
  private readonly right: CursorSlot;
  private buttons: HTMLElement[] = [];
  private rects = new Float32Array(0);
  private count = 0;
  private enabled = true;
  /** Active play: the hand cursors are off (camera mode only; the mouse pointer is unaffected). */
  private suspended = false;
  /** Time the current screen was first seen by update(), or -1 before that. */
  private screenSince = -1;
  private readonly frame: SlotFrame = {
    rects: this.rects,
    count: 0,
    revealNear: false,
    guardOver: false,
    usePose: false,
    shoulderX: 0,
    shoulderY: 0,
    dt: 0,
  };
  private readonly resize = (): void => this.refresh();
  /** Mouse input: the mitt sits exactly on the pointer and nothing is held to select. */
  private pointerMode = false;
  private hasPointer = false;
  private pointerX = 0;
  private pointerY = 0;
  private pointerDown = false;
  private lastPx = -1;
  private lastPy = -1;
  /** Only show the mitts while a hand is near a button (play screen). */
  private revealNear = false;
  private readonly onPointerMove = (e: PointerEvent): void => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
    this.pointerDown = e.buttons !== 0;
    this.hasPointer = true;
  };

  constructor(parent: HTMLElement) {
    this.left = new CursorSlot(parent, 'left');
    this.right = new CursorSlot(parent, 'right');
    window.addEventListener('resize', this.resize);
  }

  /** The pointer's element (mouse mode); in camera mode it is the right hand's cursor. */
  get el(): HTMLElement {
    return this.right.el;
  }

  /** The two hand cursors' elements. */
  get elements(): { readonly left: HTMLElement; readonly right: HTMLElement } {
    return { left: this.left.el, right: this.right.el };
  }

  /** The buttons the cursors may select on the current screen. */
  setButtons(buttons: HTMLElement[]): void {
    this.clearHover();
    this.buttons = buttons;
    this.rects = new Float32Array(buttons.length * 4);
    this.count = buttons.length;
    this.rearm();
    this.refresh();
  }

  private rearm(): void {
    this.left.rearm();
    this.right.rearm();
    this.screenSince = -1;
  }

  /** Re-measure the buttons (screen change, resize, end of the entrance animation). */
  refresh(): void {
    for (let i = 0; i < this.count; i++) {
      const r = (this.buttons[i] as HTMLElement).getBoundingClientRect();
      const o = i * 4;
      this.rects[o] = r.left;
      this.rects[o + 1] = r.top;
      this.rects[o + 2] = r.width;
      this.rects[o + 3] = r.height;
    }
  }

  /**
   * Mouse input: follow the real pointer (clientX/clientY) with no smoothing, mapping
   * or fist-to-select. Clicks do the pressing.
   */
  setPointerMode(on: boolean): void {
    if (on === this.pointerMode) return;
    this.pointerMode = on;
    this.right.el.classList.toggle('hc-pointer', on);
    if (on) {
      window.addEventListener('pointermove', this.onPointerMove, true);
      window.addEventListener('pointerdown', this.onPointerMove, true);
      window.addEventListener('pointerup', this.onPointerMove, true);
    } else {
      window.removeEventListener('pointermove', this.onPointerMove, true);
      window.removeEventListener('pointerdown', this.onPointerMove, true);
      window.removeEventListener('pointerup', this.onPointerMove, true);
    }
    this.hasPointer = false;
    this.hideAll();
  }

  /** Show the mitts only while a hand is within REVEAL_PX of a button. */
  setRevealNear(on: boolean): void {
    if (on === this.revealNear) return;
    this.revealNear = on;
    this.rearm();
  }

  /** The pointer position used in pointer mode, or null before the pointer has moved. For tests. */
  get pointerPosition(): Point2 | null {
    return this.hasPointer ? { x: this.pointerX, y: this.pointerY } : null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hideAll();
  }

  /**
   * Switch the hand cursors off while a round is being played, so a hand that wanders over a
   * button cannot press it. Pointer mode (mouse) ignores this. Coming back starts a fresh
   * screen guard so a hand resting on a button cannot select it at once.
   */
  setSuspended(on: boolean): void {
    if (on === this.suspended) return;
    this.suspended = on;
    if (on) this.hideAll();
    this.rearm();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** Remove the hover class from every button either cursor was holding over. */
  private clearHover(): void {
    this.clearSlotHover(this.left);
    this.clearSlotHover(this.right);
  }

  private clearSlotHover(s: CursorSlot): void {
    if (s.hovered >= 0) {
      (this.buttons[s.hovered] as HTMLElement | undefined)?.classList.remove('hovered');
    }
    s.hovered = -1;
  }

  private hideAll(): void {
    this.lastPx = -1;
    this.lastPy = -1;
    this.left.hide();
    this.right.hide();
    this.syncHover();
  }

  /** Mirror each cursor's hover target into the buttons' hover class (shared buttons stay lit). */
  private syncHover(): void {
    this.syncSlot(this.left, this.right);
    this.syncSlot(this.right, this.left);
  }

  private syncSlot(s: CursorSlot, other: CursorSlot): void {
    const want = s.fist.target;
    if (want === s.hovered) return;
    const old = s.hovered;
    s.hovered = want;
    if (old >= 0 && old !== other.hovered) {
      (this.buttons[old] as HTMLElement | undefined)?.classList.remove('hovered');
    }
    if (want >= 0) (this.buttons[want] as HTMLElement).classList.add('hovered');
  }

  /** Once per frame. Allocation free. */
  update(state: InputState | null, dt: number, nowMs: number): void {
    if (this.pointerMode) {
      this.updatePointer();
      return;
    }
    if (this.suspended || !this.enabled || !state || this.count === 0) {
      this.hideAll();
      return;
    }
    if (this.screenSince < 0) this.screenSince = nowMs;
    const guardOver = nowMs - this.screenSince >= SCREEN_GUARD_MS;
    const f = this.frame;
    f.rects = this.rects;
    f.count = this.count;
    f.revealNear = this.revealNear;
    f.guardOver = guardOver;
    f.dt = dt;
    f.usePose = false;
    f.shoulderX = 0;
    f.shoulderY = 0;
    if (state.hasPose) {
      const pose = state.pose;
      const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
      const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
      if (
        (pose[ls + 3] as number) >= VISIBILITY_MIN &&
        (pose[rs + 3] as number) >= VISIBILITY_MIN
      ) {
        f.usePose = true;
        f.shoulderX = ((pose[ls] as number) + (pose[rs] as number)) * 0.5;
        f.shoulderY = ((pose[ls + 1] as number) + (pose[rs + 1] as number)) * 0.5;
      }
    }
    this.left.place(state, f);
    this.right.place(state, f);

    // One activation at most: the first cursor to finish its fist wins, and the other one's
    // press is cancelled and locked out like after any selection.
    let done = this.left.fistStep(guardOver, nowMs);
    if (done >= 0) {
      this.right.cancel(nowMs);
    } else {
      done = this.right.fistStep(guardOver, nowMs);
      if (done >= 0) this.left.cancel(nowMs);
    }
    this.syncHover();
    if (done >= 0) {
      this.left.setRing(0);
      this.right.setRing(0);
      (this.buttons[done] as HTMLElement).click();
    }
  }

  /** Pointer mode, once per frame. Allocation free except when the pointer has moved. */
  private updatePointer(): void {
    const p = this.right;
    if (!this.enabled || this.count === 0 || !this.hasPointer || this.revealNear) {
      if (p.isShown) this.hideAll();
      return;
    }
    p.showEl();
    const x = Math.round(this.pointerX);
    const y = Math.round(this.pointerY);
    if (x !== this.lastPx) {
      this.lastPx = x;
      p.el.style.left = `${x}px`;
    }
    if (y !== this.lastPy) {
      this.lastPy = y;
      p.el.style.top = `${y}px`;
    }
    p.setClosed(this.pointerDown);
  }

  dispose(): void {
    this.setPointerMode(false);
    window.removeEventListener('resize', this.resize);
    this.left.dispose();
    this.right.dispose();
  }
}
