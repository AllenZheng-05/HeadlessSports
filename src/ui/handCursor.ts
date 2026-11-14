import type { InputState, Side } from '../input/types';
import { PoseIndex, POSE_STRIDE } from '../tracking/types';
import { clamp, h, svgEl } from './dom';
import { pctTenth } from './format';

/** Hold time over a button before it is chosen, ms. */
export const DWELL_MS = 1100;
/** After a selection nothing else can be chosen for this long, ms. */
export const LOCKOUT_MS = 600;
/** The other hand must be higher by this many shoulder widths... */
export const SWITCH_MARGIN_SW = 0.15;
/** ...for this long before it takes over, ms. */
export const SWITCH_HOLD_MS = 300;
/** Extra hit area around each button, px. */
export const FORGIVENESS_PX = 12;
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

/** Picks the controlling hand: the higher one, with hysteresis so it does not flip-flop. */
export class HandChooser {
  current: Side | null = null;
  private challengeSince = -1;

  reset(): void {
    this.current = null;
    this.challengeSince = -1;
  }

  /** `leftY` and `rightY` are screen y (smaller is higher); `swUnit` is the shoulder width. */
  update(
    leftOk: boolean,
    leftY: number,
    rightOk: boolean,
    rightY: number,
    swUnit: number,
    nowMs: number,
  ): Side | null {
    if (!leftOk && !rightOk) {
      this.reset();
      return null;
    }
    if (!leftOk || !rightOk) {
      this.current = leftOk ? 'left' : 'right';
      this.challengeSince = -1;
      return this.current;
    }
    if (this.current === null) {
      this.current = leftY <= rightY ? 'left' : 'right';
      this.challengeSince = -1;
      return this.current;
    }
    const curY = this.current === 'left' ? leftY : rightY;
    const otherY = this.current === 'left' ? rightY : leftY;
    const margin = (swUnit > 0 ? swUnit : 0.25) * SWITCH_MARGIN_SW;
    if (curY - otherY >= margin) {
      if (this.challengeSince < 0) this.challengeSince = nowMs;
      else if (nowMs - this.challengeSince >= SWITCH_HOLD_MS) {
        this.current = this.current === 'left' ? 'right' : 'left';
        this.challengeSince = -1;
      }
    } else {
      this.challengeSince = -1;
    }
    return this.current;
  }
}

/** Hold-to-select timing over a list of targets. Pure: feed it the hovered index each frame. */
export class DwellTracker {
  /** 0..1 progress of the current hold. */
  progress = 0;
  /** Index being held, or -1. */
  target = -1;
  private since = 0;
  private lockedUntil = -Infinity;

  constructor(
    readonly dwellMs = DWELL_MS,
    readonly lockoutMs = LOCKOUT_MS,
  ) {}

  reset(): void {
    this.target = -1;
    this.progress = 0;
  }

  /** Returns the index that was just completed, or -1. */
  update(hovered: number, nowMs: number): number {
    if (nowMs < this.lockedUntil) {
      this.target = -1;
      this.progress = 0;
      return -1;
    }
    if (hovered < 0) {
      this.reset();
      return -1;
    }
    if (hovered !== this.target) {
      this.target = hovered;
      this.since = nowMs;
      this.progress = 0;
      return -1;
    }
    this.progress = Math.min(1, (nowMs - this.since) / this.dwellMs);
    if (this.progress >= 1) {
      this.lockedUntil = nowMs + this.lockoutMs;
      const done = this.target;
      this.reset();
      return done;
    }
    return -1;
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

/** The on-screen mitt that follows the player's hand and selects buttons by holding over them. */
export class HandCursor {
  readonly el: HTMLElement;
  private readonly ring: SVGCircleElement;
  private buttons: HTMLElement[] = [];
  private rects = new Float32Array(0);
  private count = 0;
  private enabled = true;
  private shown = false;
  private closed = false;
  private hovered = -1;
  private lastRing = -1;
  private lastX = -1;
  private lastY = -1;
  private readonly chooser = new HandChooser();
  private readonly dwell = new DwellTracker();
  private readonly target: Point2 = { x: 0.5, y: 0.5 };
  private readonly smooth = new SmoothPoint();
  private readonly resize = (): void => this.refresh();

  constructor(parent: HTMLElement) {
    this.el = h('div', 'hand-cursor');
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
    this.el.append(svg, mitt);
    parent.append(this.el);
    window.addEventListener('resize', this.resize);
  }

  /** The buttons the cursor may select on the current screen. */
  setButtons(buttons: HTMLElement[]): void {
    this.clearHover();
    this.buttons = buttons;
    this.rects = new Float32Array(buttons.length * 4);
    this.count = buttons.length;
    this.dwell.reset();
    this.refresh();
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  private clearHover(): void {
    if (this.hovered >= 0)
      (this.buttons[this.hovered] as HTMLElement | undefined)?.classList.remove('hovered');
    this.hovered = -1;
  }

  private hide(): void {
    if (this.shown) {
      this.shown = false;
      this.el.hidden = true;
    }
    this.clearHover();
    this.dwell.reset();
    this.setRing(0);
    this.chooser.reset();
  }

  private setRing(progress: number): void {
    const i = Math.round(progress * 100);
    if (i === this.lastRing) return;
    this.lastRing = i;
    this.ring.setAttribute('stroke-dashoffset', RING_OFFSETS[i] as string);
  }

  /** Once per frame. Allocation free. */
  update(state: InputState | null, dt: number, nowMs: number): void {
    if (!this.enabled || !state || this.count === 0) {
      this.hide();
      return;
    }
    const pose = state.pose;
    const left = state.hands.left;
    const right = state.hands.right;
    let lOk = false;
    let rOk = false;
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    if (left.present) {
      lOk = true;
      lx = left.x;
      ly = left.y;
    } else if (state.hasPose) {
      const o = PoseIndex.LEFT_WRIST * POSE_STRIDE;
      if ((pose[o + 3] as number) >= VISIBILITY_MIN) {
        lOk = true;
        lx = pose[o] as number;
        ly = pose[o + 1] as number;
      }
    }
    if (right.present) {
      rOk = true;
      rx = right.x;
      ry = right.y;
    } else if (state.hasPose) {
      const o = PoseIndex.RIGHT_WRIST * POSE_STRIDE;
      if ((pose[o + 3] as number) >= VISIBILITY_MIN) {
        rOk = true;
        rx = pose[o] as number;
        ry = pose[o + 1] as number;
      }
    }
    const side = this.chooser.update(lOk, ly, rOk, ry, state.shoulderWidth, nowMs);
    if (side === null) {
      this.hide();
      return;
    }
    const hx = side === 'left' ? lx : rx;
    const hy = side === 'left' ? ly : ry;
    const hand = side === 'left' ? left : right;

    let usePose = false;
    let smx = 0;
    let smy = 0;
    if (state.hasPose) {
      const ls = PoseIndex.LEFT_SHOULDER * POSE_STRIDE;
      const rs = PoseIndex.RIGHT_SHOULDER * POSE_STRIDE;
      if (
        (pose[ls + 3] as number) >= VISIBILITY_MIN &&
        (pose[rs + 3] as number) >= VISIBILITY_MIN
      ) {
        usePose = true;
        smx = ((pose[ls] as number) + (pose[rs] as number)) * 0.5;
        smy = ((pose[ls + 1] as number) + (pose[rs + 1] as number)) * 0.5;
      }
    }
    mapReach(this.target, usePose, state.aspect, state.shoulderWidth, smx, smy, hx, hy);

    if (!this.shown) {
      this.shown = true;
      this.el.hidden = false;
      this.smooth.snap(this.target.x, this.target.y);
    } else {
      this.smooth.step(this.target.x, this.target.y, dt > 0 ? dt : 1 / 60);
    }
    const sx = this.smooth.x;
    const sy = this.smooth.y;
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
    const closed = hand.known && hand.closed;
    if (closed !== this.closed) {
      this.closed = closed;
      this.el.classList.toggle('closed', closed);
    }

    const hit = hitTest(
      this.rects,
      this.count,
      sx * window.innerWidth,
      sy * window.innerHeight,
      FORGIVENESS_PX,
    );
    const done = this.dwell.update(hit, nowMs);
    const shownHover = this.dwell.target;
    if (shownHover !== this.hovered) {
      this.clearHover();
      if (shownHover >= 0) {
        this.hovered = shownHover;
        (this.buttons[shownHover] as HTMLElement).classList.add('hovered');
      }
    }
    this.setRing(this.dwell.progress);
    if (done >= 0) {
      this.setRing(0);
      (this.buttons[done] as HTMLElement).click();
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.el.remove();
  }
}
