/**
 * Mouse `InputProvider` (`?input=debug`, the camera-off mode). Produces the same continuous state
 * and the same gesture events as the tracked provider, and synthesises a body pose so the athlete
 * moves.
 *
 * Players use only the mouse; there are no keyboard game controls. A sport drives everything
 * through the `MouseControl` API (see `./mouseControl.ts`) from mouse position, button and timing.
 *
 * Raw input (DOM mouse events, `moveTo` / `setButton` and every `MouseControl` action) goes into a
 * small preallocated ring and is applied at the start of the next `update(nowMs)`, so handlers
 * always run inside `update`. Events carry `t` = the `nowMs` of that update.
 */
import { createEmptyFrame, SyntheticBody } from '../../tracking/synthetic/body';
import { defaultControls } from '../../tracking/synthetic/controls';
import type { BodyControls } from '../../tracking/synthetic/controls';
import type { TrackerNeeds } from '../../tracking/types';
import { createInputState } from '../state';
import type {
  Calibration,
  GameEvent,
  GameEventOf,
  GameEventType,
  InputProvider,
  InputState,
  Side,
  Unsubscribe,
} from '../types';
import type { MouseControl, ThrowOptions, ThrowStyle } from './mouseControl';

export interface DebugInputConfig {
  /** sw/s at a tap. */
  throwMinSpeed: number;
  /** sw/s at full charge. */
  throwMaxSpeed: number;
  /** Hold time for full power, ms. */
  throwChargeMs: number;
  /** Swing speed, sw/s at power 0 (power 1 is 1.375x). */
  swingSpeed: number;
  /** SwingPeak follows SwingStarted by this many game ms. */
  swingPeakDelayMs: number;
  /** Largest sideways position, sw. */
  maxLateral: number;
  /** Largest lean, rad. */
  maxLean: number;
  /** ThrowReleased lateral (sw) for the mouse at screen centre: a natural straight throw. */
  neutralLateral: number;
}

export const debugInputConfig: DebugInputConfig = {
  throwMinSpeed: 4.5,
  throwMaxSpeed: 10,
  throwChargeMs: 900,
  swingSpeed: 8,
  swingPeakDelayMs: 90,
  maxLateral: 2.0,
  maxLean: 0.45,
  neutralLateral: 0.62,
};

const RING = 128;
const KIND_MOVE = 2;
const KIND_BUTTON = 3;
// MouseControl actions. Numeric arguments travel in a/b/c/d; NaN means "derive it from the pointer".
const KIND_FIST = 4; // a side, down closed
const KIND_WINDUP = 5; // a side (-1 selected), b style (0 overarm, 1 underarm)
const KIND_RELEASE = 6; // a power (-1 charge), b loft, c lateral, d curvature
const KIND_SWING = 7; // a power, b height, c direction (0 selected hand)
const KIND_RUN = 8; // a steps per second
const KIND_STEP = 9;
const KIND_ARMS = 10; // a 0 none, 1 left, 2 right, 3 both
const KIND_PUNCH = 11; // a side (-1 selected)
const KIND_SQUAT = 12; // down
const KIND_JUMP = 13;
const KIND_LATERAL = 14; // a
const KIND_LEAN = 15; // a
const KIND_RECENTRE = 16;
const KIND_TARGET = 17; // a side, x, y

interface RawInput {
  kind: number;
  x: number;
  y: number;
  down: boolean;
  a: number;
  b: number;
  c: number;
  d: number;
}

const ASPECT = 16 / 9;
const STEP_AMPLITUDE = 0.4;
const STEP_DECAY_MS = 800;
const KNEE_MS = 250;
const JUMP_MS = 400;
const JUMP_HEIGHT = 0.35;
const SQUAT_DEPTH = 0.5;
const CROUCH_DROP = 1.2;
const TORSO = 1.45;
const REACH = 1.45;
const FOLLOW_MS = 250;
const PULSE_MS = 250;
const PUNCH_SPEED = 6;
const MAX_PENDING = 4;
const CURL_CLOSED = 0.8;
const CURL_OPEN = 1.8;
const SIDES: readonly Side[] = ['left', 'right'];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sideSign(side: Side): number {
  return side === 'left' ? -1 : 1;
}

/** Elements whose presses belong to the interface, not the game. */
const UI_SELECTOR = 'button, a, input, select, textarea, [data-ui]';

/**
 * True when a mouse event landed on interface chrome (a button, link, form field, or anything
 * inside an element marked `data-ui`): such a press or release is never a game press.
 */
export function isUiTarget(target: EventTarget | null): boolean {
  const el = target as { closest?: unknown } | null;
  if (!el || typeof el.closest !== 'function') return false;
  return (el as Element).closest(UI_SELECTOR) !== null;
}

export class DebugInput implements InputProvider, MouseControl {
  readonly state: InputState = createInputState();
  readonly source = null;
  readonly mouseControl = true as const;

  private readonly config: DebugInputConfig;
  private readonly target: EventTarget;
  private readonly viewport: () => { left: number; top: number; width: number; height: number };
  private needs: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: false };

  // Listener registry.
  private byType = new Map<GameEventType, ((e: never) => void)[]>();
  private anyHandlers: ((e: GameEvent) => void)[] = [];

  // Raw input ring.
  private readonly ring: RawInput[] = [];
  private head = 0;
  private count = 0;

  private stopped = false;
  private started = false;
  private lastT = 0;

  // Input state.
  private selected: Side = 'right';
  private mouseX = 0.5;
  private mouseY = 0.5;
  private mouseFistSide: Side | null = null;
  /** Manual mode (a sport turns it on): the mouse button has no built-in effect on the fists. */
  private pointerOn = false;
  /** Mouse movement moves the selected hand (default). Off: the sport sets hand targets. */
  private follow = true;
  // Press tracking (filtered: only presses on the game count).
  private pressDown = false;
  private pressT = 0;
  private presses = 0;
  private releases = 0;
  private heldMs = 0;
  /** A DOM press that counted is waiting for its release, wherever the release lands. */
  private domPressOpen = false;
  // Continuous run set by `setRunCadence` (steps per second, 0 off).
  private autoRate = 0;

  // Gestures.
  private raisedOne: Side | null = null;
  private raisedBoth = false;
  private throwStart = -1;
  private throwHand: Side = 'right';
  private throwStyle: 'overarm' | 'underarm' = 'overarm';
  private throwReleasedAt = -1e9;
  private throwReleasedStyle: 'overarm' | 'underarm' = 'overarm';
  private throwReleasedHand: Side = 'right';
  private squatting = false;
  private jumpStart = -1e9;
  private readonly pending = {
    n: 0,
    at: new Float64Array(MAX_PENDING),
    speed: new Float64Array(MAX_PENDING),
    height: new Float64Array(MAX_PENDING),
    plane: new Float64Array(MAX_PENDING),
  };
  private readonly pulseAt = { left: -1e9, right: -1e9 };
  private readonly pulseSpeed = { left: 0, right: 0 };

  // Running.
  private nextStepSide: Side = 'left';
  private readonly stepTimes = new Float64Array(5);
  private stepCount = 0;
  private lastStepT = -1e9;
  private autoNext = 0;
  private readonly kneeStart = { left: -1e9, right: -1e9 };
  private kneeDur = KNEE_MS;

  // Synthesis.
  private readonly controls: BodyControls = defaultControls();
  private readonly body = new SyntheticBody(ASPECT, { sigma: 0 });
  private readonly frame = createEmptyFrame(ASPECT);
  private readonly prevX = { left: 0, right: 0 };
  private readonly prevY = { left: 0, right: 0 };

  private readonly onMouseMove = (e: Event): void => {
    const me = e as MouseEvent;
    const vp = this.viewport();
    const x = vp.width > 0 ? (me.clientX - vp.left) / vp.width : 0.5;
    const y = vp.height > 0 ? (me.clientY - vp.top) / vp.height : 0.5;
    this.moveTo(x, y);
  };
  private readonly onMouseDown = (e: Event): void => {
    if ((e as MouseEvent).button !== 0 || isUiTarget(e.target)) return;
    this.domPressOpen = true;
    this.setButton(true);
  };
  private readonly onMouseUp = (e: Event): void => {
    // A release counts only if its press did, and wherever it lands (so a drag that ends over a
    // button still lets go).
    if ((e as MouseEvent).button !== 0 || !this.domPressOpen) return;
    this.domPressOpen = false;
    this.setButton(false);
  };
  private readonly onBlur = (): void => {
    if (!this.domPressOpen) return;
    this.domPressOpen = false;
    this.setButton(false);
  };

  constructor(
    options: {
      target?: EventTarget;
      viewport?: () => { left: number; top: number; width: number; height: number };
      config?: DebugInputConfig;
    } = {},
  ) {
    this.config = options.config ?? debugInputConfig;
    this.target = options.target ?? window;
    this.viewport =
      options.viewport ??
      (() => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }));
    for (let i = 0; i < RING; i++) {
      this.ring.push({
        kind: 0,
        x: 0,
        y: 0,
        down: false,
        a: 0,
        b: 0,
        c: 0,
        d: 0,
      });
    }
    const s = this.state;
    s.tracking = true;
    s.problem = 'none';
    s.aspect = ASPECT;
    s.hasPose = true;
    s.shoulderWidth = this.controls.shoulderWidth;
    for (const side of ['left', 'right'] as const) {
      const h = s.hands[side];
      h.present = true;
      h.known = true;
      h.closed = false;
      h.curl = CURL_OPEN;
      h.x = 0.5 + sideSign(side) * 0.05;
      h.y = 0.5;
      this.prevX[side] = h.x;
      this.prevY[side] = h.y;
    }
    this.target.addEventListener('mousemove', this.onMouseMove);
    this.target.addEventListener('mousedown', this.onMouseDown);
    this.target.addEventListener('mouseup', this.onMouseUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  // InputProvider --------------------------------------------------------------------------

  start(needs: TrackerNeeds): Promise<void> {
    this.needs = needs;
    this.state.tracking = true;
    this.state.problem = 'none';
    return Promise.resolve();
  }

  setNeeds(needs: TrackerNeeds): Promise<void> {
    this.needs = needs;
    return Promise.resolve();
  }

  setCalibration(_calibration: Calibration | null): void {
    // Debug input needs no calibration.
  }

  on<T extends GameEventType>(type: T, handler: (event: GameEventOf<T>) => void): Unsubscribe {
    const list = this.byType.get(type) ?? [];
    const h = handler as (e: never) => void;
    this.byType.set(type, [...list, h]);
    return () => {
      const cur = this.byType.get(type);
      if (cur) {
        this.byType.set(
          type,
          cur.filter((x) => x !== h),
        );
      }
    };
  }

  onAny(handler: (event: GameEvent) => void): Unsubscribe {
    this.anyHandlers = [...this.anyHandlers, handler];
    return () => {
      this.anyHandlers = this.anyHandlers.filter((x) => x !== handler);
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.count = 0;
    this.pending.n = 0;
  }

  // Programmatic control --------------------------------------------------------------------

  moveTo(x: number, y: number): void {
    this.act(KIND_MOVE, 0, 0, 0, 0, false, clamp(x, 0, 1), clamp(y, 0, 1));
  }

  setButton(down: boolean): void {
    this.act(KIND_BUTTON, 0, 0, 0, 0, down);
  }

  /**
   * Manual mode: the mouse button no longer has any built-in effect (no fist close on press); the
   * sport reads `pointerDown` / `pointerPresses` / `pointerReleases` / `pointerHeldMs` and decides.
   * Turning it on or off lets go of a fist the mouse was holding. Off by default.
   */
  setManualMode(on: boolean): void {
    if (this.pointerOn === on) return;
    this.pointerOn = on;
    if (this.mouseFistSide) {
      this.setFist(this.mouseFistSide, false, this.lastT);
      this.mouseFistSide = null;
    }
  }

  /** True while the mouse button is down (a press that landed on the game). */
  get pointerDown(): boolean {
    return this.pressDown;
  }

  /** Monotonic count of presses that landed on the game. */
  get pointerPresses(): number {
    return this.presses;
  }

  /** Monotonic count of releases that matched a counted press. */
  get pointerReleases(): number {
    return this.releases;
  }

  /** Game ms the button has currently been down, as of the last `update`; 0 when up. */
  get pointerHeldMs(): number {
    return this.heldMs;
  }

  /** Mouse movement moves the selected hand (default true). False: the sport sets hand targets. */
  setPointerFollow(follow: boolean): void {
    this.follow = follow;
  }

  /** Put a hand's cursor at a mirrored-image position (applied on the next update). */
  setHandTarget(side: Side, x: number, y: number): void {
    this.act(KIND_TARGET, side === 'left' ? 0 : 1, 0, 0, 0, false, clamp(x, 0, 1), clamp(y, 0, 1));
  }

  /** Open or close a hand, as the held button does. Emits FistClosed / FistOpened. */
  setHandClosed(side: Side, closed: boolean): void {
    this.act(KIND_FIST, side === 'left' ? 0 : 1, 0, 0, 0, closed);
  }

  /** ThrowWindup now, and the arm goes back. Ignored if already winding up. */
  startWindup(side?: Side, style: ThrowStyle = 'overarm'): void {
    this.act(
      KIND_WINDUP,
      side === undefined ? -1 : side === 'left' ? 0 : 1,
      style === 'overarm' ? 0 : 1,
      0,
      0,
      false,
    );
  }

  /**
   * ThrowReleased. `power` 0..1 maps to speed between throwMinSpeed and
   * throwMaxSpeed; omitted, it is the hold time over throwChargeMs. Loft and lateral default to the
   * values derived from the pointer; curvature to 0. No-op without a windup.
   */
  releaseThrow(power?: number, opts: ThrowOptions = {}): void {
    this.act(
      KIND_RELEASE,
      power === undefined ? -1 : power,
      opts.loft ?? Number.NaN,
      opts.lateral ?? Number.NaN,
      opts.curvature ?? Number.NaN,
      false,
    );
  }

  /** A whole throw at once: `startWindup` then `releaseThrow` in the same update. */
  throwNow(power: number, opts: ThrowOptions & { hand?: Side; style?: ThrowStyle } = {}): void {
    this.startWindup(opts.hand, opts.style);
    this.releaseThrow(power, opts);
  }

  /**
   * SwingStarted now and SwingPeak after swingPeakDelayMs. `power` 0..1 goes from
   * swingSpeed to 1.375x. `height` -1..1 defaults to the pointer height; `direction`
   * to the selected hand (-1 left, 1 right).
   */
  swing(opts: { power?: number; height?: number; direction?: -1 | 1 } = {}): void {
    this.act(KIND_SWING, opts.power ?? 0, opts.height ?? Number.NaN, opts.direction ?? 0, 0, false);
  }

  /** Run continuously at this many steps per second (Step events and legs, as with `step`); 0 stops. */
  setRunCadence(stepsPerSecond: number): void {
    this.act(KIND_RUN, Math.max(0, stepsPerSecond), 0, 0, 0, false);
  }

  /** One running step, alternating legs. */
  step(): void {
    this.act(KIND_STEP, 0, 0, 0, 0, false);
  }

  /** Raise one arm, both, or lower them ('none'). Emits ArmRaised / ArmLowered. */
  setArmsRaised(which: 'none' | Side | 'both'): void {
    const a = which === 'none' ? 0 : which === 'left' ? 1 : which === 'right' ? 2 : 3;
    this.act(KIND_ARMS, a, 0, 0, 0, false);
  }

  /** Punch with a hand (default the selected one). */
  punch(side?: Side): void {
    this.act(KIND_PUNCH, side === undefined ? -1 : side === 'left' ? 0 : 1, 0, 0, 0, false);
  }

  /** Squat while true (Squat is emitted on the way down). */
  setSquat(on: boolean): void {
    this.act(KIND_SQUAT, 0, 0, 0, 0, on);
  }

  /** Jump. */
  jump(): void {
    this.act(KIND_JUMP, 0, 0, 0, 0, false);
  }

  /** Sideways position in shoulder widths (clamped). */
  setLateral(sw: number): void {
    this.act(KIND_LATERAL, sw, 0, 0, 0, false);
  }

  /** Lean in radians (clamped). */
  setLean(rad: number): void {
    this.act(KIND_LEAN, rad, 0, 0, 0, false);
  }

  /** Lateral and lean back to 0. */
  recentre(): void {
    this.act(KIND_RECENTRE, 0, 0, 0, 0, false);
  }

  /** Mouse position as a mirrored-image position (the same space as a hand's x and y). */
  get pointerX(): number {
    return this.mouseX;
  }
  get pointerY(): number {
    return this.mouseY;
  }

  get selectedHand(): Side {
    return this.selected;
  }

  /** Choose which hand the mouse moves, and put it under the mouse straight away. */
  selectHand(side: Side): void {
    this.selected = side;
    if (this.follow) this.moveCursor(side);
  }

  private act(
    kind: number,
    a: number,
    b: number,
    c: number,
    d: number,
    down: boolean,
    x = 0,
    y = 0,
  ): void {
    if (this.stopped || this.count >= RING) return;
    const r = this.ring[(this.head + this.count) % RING];
    r.kind = kind;
    r.x = x;
    r.y = y;
    r.down = down;
    r.a = a;
    r.b = b;
    r.c = c;
    r.d = d;
    this.count++;
  }

  // Events ---------------------------------------------------------------------------------

  private emit(e: GameEvent): void {
    const list = this.byType.get(e.type);
    if (list) for (const h of list) (h as (ev: GameEvent) => void)(e);
    const any = this.anyHandlers;
    for (const h of any) h(e);
  }

  // Update ---------------------------------------------------------------------------------

  update(nowMs: number): void {
    if (this.stopped) return;
    const dtMs = this.started ? Math.max(0, nowMs - this.lastT) : 0;
    const dt = dtMs / 1000;
    this.started = true;
    this.lastT = nowMs;
    const s = this.state;

    while (this.count > 0) {
      const r = this.ring[this.head];
      this.head = (this.head + 1) % RING;
      this.count--;
      this.apply(r, nowMs);
    }

    this.heldMs = this.pressDown ? Math.max(0, nowMs - this.pressT) : 0;
    this.autoRun(nowMs);
    this.flushSwingPeaks(nowMs);

    // Rise.
    let rise = this.squatting ? -SQUAT_DEPTH : 0;
    const jp = (nowMs - this.jumpStart) / JUMP_MS;
    if (jp >= 0 && jp < 1) rise += JUMP_HEIGHT * Math.sin(Math.PI * jp);
    s.rise = rise;

    this.updateCadence(nowMs);

    s.tPrev = s.t;
    s.t = nowMs;
    s.tracking = true;
    s.problem = 'none';
    s.aspect = ASPECT;
    s.shoulderWidth = this.controls.shoulderWidth;
    const hasPose = this.needs.pose;
    s.hasPose = hasPose;

    this.synthesise(nowMs, dt, hasPose);
  }

  private apply(r: RawInput, nowMs: number): void {
    if (r.kind >= KIND_FIST) {
      this.applyAction(r, nowMs);
    } else if (r.kind === KIND_MOVE) {
      this.mouseX = r.x;
      this.mouseY = r.y;
      if (this.follow) this.moveCursor(this.selected);
    } else if (r.kind === KIND_BUTTON) {
      const edge = r.down !== this.pressDown;
      if (edge) {
        this.pressDown = r.down;
        if (r.down) {
          this.presses++;
          this.pressT = nowMs;
          this.heldMs = 0;
        } else {
          this.releases++;
          this.heldMs = 0;
        }
      }
      if (this.pointerOn) {
        // Manual mode: the sport reads the pointer state and decides.
      } else if (r.down) {
        this.mouseFistSide = this.selected;
        this.setFist(this.selected, true, nowMs);
      } else if (this.mouseFistSide) {
        this.setFist(this.mouseFistSide, false, nowMs);
        this.mouseFistSide = null;
      }
    }
  }

  private moveCursor(side: Side): void {
    const h = this.state.hands[side];
    h.x = this.mouseX;
    h.y = this.mouseY;
  }

  private setFist(side: Side, closed: boolean, nowMs: number): void {
    const h = this.state.hands[side];
    if (h.closed === closed) return;
    h.closed = closed;
    this.emit({ type: closed ? 'FistClosed' : 'FistOpened', t: nowMs, hand: side });
  }

  /** The MouseControl actions. */
  private applyAction(r: RawInput, nowMs: number): void {
    const s = this.state;
    switch (r.kind) {
      case KIND_FIST:
        this.setFist(r.a === 0 ? 'left' : 'right', r.down, nowMs);
        break;
      case KIND_WINDUP:
        this.beginThrow(
          nowMs,
          r.a < 0 ? this.selected : r.a === 0 ? 'left' : 'right',
          r.b === 0 ? 'overarm' : 'underarm',
        );
        break;
      case KIND_RELEASE:
        this.endThrow(nowMs, r.a, r.b, r.c, r.d);
        break;
      case KIND_SWING:
        this.doSwing(nowMs, r.a, r.b, r.c);
        break;
      case KIND_RUN:
        if (r.a > 0 && this.autoRate <= 0) this.autoNext = nowMs;
        this.autoRate = r.a;
        break;
      case KIND_STEP:
        this.doStep(nowMs, nowMs);
        break;
      case KIND_ARMS:
        if (r.a === 0) {
          this.lowerOne(nowMs);
          this.lowerBoth(nowMs);
        } else if (r.a === 3) {
          this.raiseBoth(nowMs);
        } else {
          const side: Side = r.a === 1 ? 'left' : 'right';
          if (this.raisedBoth) this.lowerBoth(nowMs);
          if (this.raisedOne !== null && this.raisedOne !== side) this.lowerOne(nowMs);
          if (this.raisedOne === null) this.raiseOne(side, nowMs);
        }
        break;
      case KIND_PUNCH:
        this.doPunch(r.a < 0 ? this.selected : r.a === 0 ? 'left' : 'right', nowMs);
        break;
      case KIND_SQUAT:
        if (r.down !== this.squatting) this.doSquat(r.down, nowMs);
        break;
      case KIND_JUMP:
        this.doJump(nowMs);
        break;
      case KIND_LATERAL:
        s.lateral = clamp(r.a, -this.config.maxLateral, this.config.maxLateral);
        break;
      case KIND_LEAN:
        s.lean = clamp(r.a, -this.config.maxLean, this.config.maxLean);
        break;
      case KIND_RECENTRE:
        s.lateral = 0;
        s.lean = 0;
        break;
      case KIND_TARGET: {
        const h = s.hands[r.a === 0 ? 'left' : 'right'];
        h.x = r.x;
        h.y = r.y;
        break;
      }
      default:
        break;
    }
  }

  private raiseOne(side: Side, nowMs: number): void {
    this.raisedOne = side;
    this.emit({ type: 'ArmRaised', t: nowMs, hand: side, both: false });
  }

  private lowerOne(nowMs: number): void {
    if (this.raisedOne !== null) {
      this.emit({ type: 'ArmLowered', t: nowMs, hand: this.raisedOne });
      this.raisedOne = null;
    }
  }

  private raiseBoth(nowMs: number): void {
    this.lowerOne(nowMs);
    this.raisedBoth = true;
    this.emit({ type: 'ArmRaised', t: nowMs, hand: 'left', both: true });
    this.emit({ type: 'ArmRaised', t: nowMs, hand: 'right', both: true });
  }

  private lowerBoth(nowMs: number): void {
    if (this.raisedBoth) {
      this.raisedBoth = false;
      this.emit({ type: 'ArmLowered', t: nowMs, hand: 'left' });
      this.emit({ type: 'ArmLowered', t: nowMs, hand: 'right' });
    }
  }

  private beginThrow(nowMs: number, hand: Side, style: ThrowStyle): void {
    if (this.throwStart >= 0) return;
    this.throwStart = nowMs;
    this.throwHand = hand;
    this.throwStyle = style;
    this.emit({ type: 'ThrowWindup', t: nowMs, hand });
  }

  /** `power` < 0 means the hold time; a NaN loft, lateral or curvature is derived from the pointer. */
  private endThrow(
    nowMs: number,
    power: number,
    loftIn: number,
    lateralIn: number,
    curvatureIn: number,
  ): void {
    if (this.throwStart < 0) return;
    const c = this.config;
    const charge =
      power >= 0 ? clamp(power, 0, 1) : clamp((nowMs - this.throwStart) / c.throwChargeMs, 0, 1);
    const speed = c.throwMinSpeed + (c.throwMaxSpeed - c.throwMinSpeed) * charge;
    const lateral = Number.isNaN(lateralIn)
      ? sideSign(this.throwHand) * c.neutralLateral + (this.mouseX - 0.5) * 4
      : lateralIn;
    const loft = Number.isNaN(loftIn)
      ? this.throwStyle === 'overarm'
        ? clamp((0.5 - this.mouseY) * 1.6 + 0.6, 0, 1.4)
        : 0.3
      : loftIn;
    const curvature = Number.isNaN(curvatureIn) ? 0 : curvatureIn;
    this.emit({
      type: 'ThrowReleased',
      t: nowMs,
      hand: this.throwHand,
      speed,
      vx: lateral === 0 ? 0 : speed * Math.cos(loft) * Math.sign(lateral),
      vy: speed * Math.sin(loft),
      lateral,
      loft,
      curvature,
      style: this.throwStyle,
    });
    this.throwReleasedAt = nowMs;
    this.throwReleasedStyle = this.throwStyle;
    this.throwReleasedHand = this.throwHand;
    this.pulse(this.throwHand, nowMs, speed);
    this.throwStart = -1;
  }

  /** `power` 0..1 is swingSpeed up to 1.375x; a NaN height is the pointer height; direction 0 is the selected hand. */
  private doSwing(nowMs: number, power: number, heightIn: number, direction: number): void {
    const c = this.config;
    const speed = c.swingSpeed * (1 + 0.375 * clamp(power, 0, 1));
    const height = Number.isNaN(heightIn) ? (0.5 - this.mouseY) * 2 : clamp(heightIn, -1, 1);
    const plane = height * 0.4;
    this.emit({
      type: 'SwingStarted',
      t: nowMs,
      speed,
      height,
      direction: direction === 0 ? (this.selected === 'left' ? -1 : 1) : direction < 0 ? -1 : 1,
    });
    const p = this.pending;
    if (p.n < MAX_PENDING) {
      p.at[p.n] = nowMs + c.swingPeakDelayMs;
      p.speed[p.n] = speed;
      p.height[p.n] = height;
      p.plane[p.n] = plane;
      p.n++;
    }
  }

  private doPunch(side: Side, nowMs: number): void {
    this.emit({ type: 'Punch', t: nowMs, hand: side, speed: PUNCH_SPEED });
    this.pulse(side, nowMs, PUNCH_SPEED);
  }

  private doSquat(on: boolean, nowMs: number): void {
    this.squatting = on;
    if (on) this.emit({ type: 'Squat', t: nowMs, depth: SQUAT_DEPTH });
  }

  private doJump(nowMs: number): void {
    this.jumpStart = nowMs;
    this.emit({ type: 'Jump', t: nowMs, height: JUMP_HEIGHT });
  }

  private pulse(side: Side, nowMs: number, speed: number): void {
    this.pulseAt[side] = nowMs;
    this.pulseSpeed[side] = speed;
  }

  private flushSwingPeaks(nowMs: number): void {
    const p = this.pending;
    let w = 0;
    for (let i = 0; i < p.n; i++) {
      if (nowMs >= p.at[i]) {
        this.emit({
          type: 'SwingPeak',
          t: nowMs,
          speed: p.speed[i],
          height: p.height[i],
          plane: p.plane[i],
        });
      } else {
        p.at[w] = p.at[i];
        p.speed[w] = p.speed[i];
        p.height[w] = p.height[i];
        p.plane[w] = p.plane[i];
        w++;
      }
    }
    p.n = w;
  }

  // Running --------------------------------------------------------------------------------

  private autoRun(nowMs: number): void {
    if (this.autoRate <= 0) return;
    const interval = 1000 / this.autoRate;
    let n = 0;
    while (nowMs >= this.autoNext && n < 4) {
      this.doStep(nowMs, this.autoNext);
      this.autoNext += interval;
      n++;
    }
    if (nowMs >= this.autoNext) this.autoNext = nowMs + interval;
  }

  /** `eventT` goes on the event; `nominalT` is the time used for cadence. */
  private doStep(eventT: number, nominalT: number): void {
    const side = this.nextStepSide;
    this.nextStepSide = side === 'left' ? 'right' : 'left';
    this.emit({ type: 'Step', t: eventT, side, amplitude: STEP_AMPLITUDE });
    if (nominalT - this.lastStepT > STEP_DECAY_MS) this.stepCount = 0;
    if (this.stepCount < 5) {
      this.stepTimes[this.stepCount++] = nominalT;
    } else {
      for (let i = 0; i < 4; i++) this.stepTimes[i] = this.stepTimes[i + 1];
      this.stepTimes[4] = nominalT;
    }
    this.lastStepT = nominalT;
    this.kneeStart[side] = eventT;
    if (this.stepCount >= 2) {
      const mean = (this.stepTimes[this.stepCount - 1] - this.stepTimes[0]) / (this.stepCount - 1);
      this.kneeDur = Math.min(KNEE_MS, mean * 0.9);
    } else {
      this.kneeDur = KNEE_MS;
    }
  }

  private updateCadence(nowMs: number): void {
    const cad = this.state.cadence;
    const since = nowMs - this.lastStepT;
    if (since >= STEP_DECAY_MS && this.autoRate <= 0) {
      cad.stepsPerSecond = 0;
      cad.amplitude = 0;
      return;
    }
    cad.amplitude = STEP_AMPLITUDE;
    if (this.stepCount < 2) {
      cad.stepsPerSecond = 0;
      return;
    }
    const mean = (this.stepTimes[this.stepCount - 1] - this.stepTimes[0]) / (this.stepCount - 1);
    const base = mean > 0 ? 1000 / mean : 0;
    // Hold the rate while the next step is not yet overdue, then fall linearly to 0 at 800 ms.
    const fade = since <= mean ? 1 : clamp((STEP_DECAY_MS - since) / (STEP_DECAY_MS - mean), 0, 1);
    cad.stepsPerSecond = base * fade;
  }

  // Synthesis ------------------------------------------------------------------------------

  private synthesise(nowMs: number, dt: number, hasPose: boolean): void {
    const s = this.state;
    const c = this.controls;
    const sw = c.shoulderWidth;
    const swN = sw / ASPECT;

    c.centreX = 0.5 + s.lateral * swN;
    c.lean = s.lean;
    c.crouch = clamp(-s.rise / CROUCH_DROP, 0, 1);
    c.jump = Math.max(0, s.rise);
    c.leftKnee = this.knee('left', nowMs);
    c.rightKnee = this.knee('right', nowMs);
    c.leftFist = s.hands.left.closed ? 1 : 0;
    c.rightFist = s.hands.right.closed ? 1 : 0;
    c.handsOnly = 0;
    c.bodyVisible = 1;
    c.leftHandVisible = 1;
    c.rightHandVisible = 1;

    // Shoulder positions (mirrors SyntheticBody's torso layout).
    const sinL = Math.sin(c.lean);
    const cosL = Math.cos(c.lean);
    const drop = (c.crouch * CROUCH_DROP - c.jump) * sw;
    const midX = c.centreX + (sinL * TORSO * sw) / ASPECT;
    const midY = c.shoulderY + drop + TORSO * sw * (1 - cosL);

    for (let si = 0; si < 2; si++) {
      const side = SIDES[si];
      const sg = sideSign(side);
      const h = s.hands[side];
      h.curl = h.closed ? CURL_CLOSED : CURL_OPEN;
      h.present = true;
      h.known = true;

      // Cursor velocity, sw/s, smoothed. y positive up, like the arm and throw vectors.
      if (dt > 0) {
        const a = 1 - Math.exp(-dt / 0.05);
        const rvx = ((h.x - this.prevX[side]) * ASPECT) / sw / dt;
        const rvy = -(h.y - this.prevY[side]) / sw / dt;
        h.vx += (rvx - h.vx) * a;
        h.vy += (rvy - h.vy) * a;
      }
      this.prevX[side] = h.x;
      this.prevY[side] = h.y;

      // Wrist target relative to the shoulder, sw, y up.
      // The right shoulder is at +0.5 sw (screen right), as in SyntheticBody.
      const shX = midX + (sg * 0.5 * sw * cosL) / ASPECT;
      const shY = midY + sg * 0.5 * sw * sinL;
      let wx = ((h.x - shX) * ASPECT) / sw;
      let wy = (shY - h.y) / sw;

      if (this.raisedBoth || this.raisedOne === side) {
        wx = sg * 0.2;
        wy = 1.4;
      }
      if (this.throwStart >= 0 && this.throwHand === side) {
        const k = clamp((nowMs - this.throwStart) / 200, 0, 1);
        const bx = this.throwStyle === 'overarm' ? sg * 0.6 : sg * 0.3;
        const by = this.throwStyle === 'overarm' ? 1.2 : -0.9;
        wx += (bx - wx) * k;
        wy += (by - wy) * k;
      } else if (this.throwReleasedHand === side) {
        const p = (nowMs - this.throwReleasedAt) / FOLLOW_MS;
        if (p >= 0 && p < 1) {
          const over = this.throwReleasedStyle === 'overarm';
          const bx = over ? sg * 0.6 : sg * 0.3;
          const by = over ? 1.2 : -0.9;
          const fx = over ? -sg * 0.2 : sg * 0.1;
          const fy = over ? 0.5 : 1.0;
          const q = p * p * (3 - 2 * p);
          wx = bx + (fx - bx) * q;
          wy = by + (fy - by) * q;
        }
      }
      const len = Math.hypot(wx, wy);
      if (len > REACH) {
        wx = (wx / len) * REACH;
        wy = (wy / len) * REACH;
      }
      if (side === 'left') {
        c.leftWristX = wx;
        c.leftWristY = wy;
      } else {
        c.rightWristX = wx;
        c.rightWristY = wy;
      }

      const arm = s.arms[side];
      arm.wristX = wx;
      arm.wristY = wy;
      arm.vx = 0;
      arm.vy = 0;
      arm.elbowAngle = Math.PI;
      arm.elbowRate = 0;
      const pp = (nowMs - this.pulseAt[side]) / PULSE_MS;
      arm.speed = pp >= 0 && pp < 1 ? this.pulseSpeed[side] * (1 - pp) : 0;
    }

    if (hasPose) {
      s.posePrev.set(s.pose);
      this.body.write(c, this.frame);
      s.pose.set(this.frame.pose);
    }
  }

  private knee(side: Side, nowMs: number): number {
    const p = (nowMs - this.kneeStart[side]) / this.kneeDur;
    return p >= 0 && p < 1 ? Math.sin(Math.PI * p) : 0;
  }
}
