/**
 * Keyboard-and-mouse `InputProvider` (`?input=debug`). Produces the same continuous state and the
 * same gesture events as the tracked provider, and synthesises a body pose so the athlete moves.
 *
 * Raw input (DOM events and the programmatic press/release/moveTo/setButton) goes into a small
 * preallocated ring and is applied at the start of the next `update(nowMs)`, so handlers always run
 * inside `update`. Events carry `t` = the `nowMs` of that update.
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

export interface DebugInputConfig {
  /** sw/s at a tap. */
  throwMinSpeed: number;
  /** sw/s at full charge. */
  throwMaxSpeed: number;
  /** Hold time for full power, ms. */
  throwChargeMs: number;
  /** Swing speed, sw/s (Shift held: 11). */
  swingSpeed: number;
  /** SwingPeak follows SwingStarted by this many game ms. */
  swingPeakDelayMs: number;
  /** Auto-run step rate while ArrowUp is held (Shift held: 4.5). */
  autoRunStepsPerSecond: number;
  /** sw per second while an arrow key is held. */
  lateralRate: number;
  /** rad per second. */
  leanRate: number;
  maxLateral: number;
  maxLean: number;
  /** Curvature magnitude applied while Z or C is held. */
  curve: number;
}

export const debugInputConfig: DebugInputConfig = {
  throwMinSpeed: 4.5,
  throwMaxSpeed: 10,
  throwChargeMs: 900,
  swingSpeed: 8,
  swingPeakDelayMs: 90,
  autoRunStepsPerSecond: 3.2,
  lateralRate: 1.2,
  leanRate: 0.8,
  maxLateral: 2.0,
  maxLean: 0.45,
  curve: 0.6,
};

/** One row per binding, for an on-screen help overlay. */
export const DEBUG_KEYS: readonly { keys: string; action: string }[] = [
  { keys: 'Mouse', action: 'Move the selected hand' },
  { keys: 'A / D', action: 'Select left / right hand' },
  { keys: 'Left button (hold)', action: 'Close the selected hand' },
  { keys: 'Q / E', action: 'Toggle left / right fist' },
  { keys: 'U (hold)', action: 'Raise the selected arm' },
  { keys: 'I (hold)', action: 'Raise both arms' },
  { keys: 'T (hold, release)', action: 'Overarm throw, longer hold is harder' },
  { keys: 'B (hold, release)', action: 'Underarm throw / bowl, longer hold is harder' },
  { keys: 'Z / C (hold)', action: 'Curve the throw left / right' },
  { keys: 'S', action: 'Swing (Shift: faster)' },
  { keys: 'R', action: 'One running step' },
  { keys: 'Up arrow (hold)', action: 'Auto-run (Shift: faster)' },
  { keys: 'Left / Right arrows', action: 'Move sideways' },
  { keys: 'Shift + Left / Right arrows', action: 'Lean' },
  { keys: 'Down arrow', action: 'Recentre position and lean' },
  { keys: 'P', action: 'Punch with the selected hand' },
  { keys: 'K (hold)', action: 'Squat' },
  { keys: 'J', action: 'Jump' },
];

const RING = 128;
const KIND_DOWN = 0;
const KIND_UP = 1;
const KIND_MOVE = 2;
const KIND_BUTTON = 3;

interface RawInput {
  kind: number;
  code: string;
  shift: boolean;
  x: number;
  y: number;
  down: boolean;
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
const HANDLED_PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sideSign(side: Side): number {
  return side === 'left' ? -1 : 1;
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el) return false;
  if (typeof el.tagName === 'string') {
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  }
  return el.isContentEditable === true;
}

export class DebugInput implements InputProvider {
  readonly state: InputState = createInputState();
  readonly source = null;

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
  private readonly held = new Set<string>();
  private shift = false;
  private selected: Side = 'right';
  private mouseX = 0.5;
  private mouseY = 0.5;
  private mouseMoved = false;
  private mouseFistSide: Side | null = null;

  // Gestures.
  private raisedOne: Side | null = null;
  private raisedBoth = false;
  private throwStart = -1;
  private throwHand: Side = 'right';
  private throwKey = '';
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
  private autoActive = false;
  private readonly kneeStart = { left: -1e9, right: -1e9 };
  private kneeDur = KNEE_MS;

  // Synthesis.
  private readonly controls: BodyControls = defaultControls();
  private readonly body = new SyntheticBody(ASPECT, { sigma: 0 });
  private readonly frame = createEmptyFrame(ASPECT);
  private readonly prevX = { left: 0, right: 0 };
  private readonly prevY = { left: 0, right: 0 };

  private readonly onKeyDown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.repeat || isTextTarget(ke.target)) return;
    if (HANDLED_PREVENT.has(ke.code)) ke.preventDefault();
    this.enqueue(KIND_DOWN, ke.code, ke.shiftKey, 0, 0, false);
  };
  private readonly onKeyUp = (e: Event): void => {
    const ke = e as KeyboardEvent;
    this.enqueue(KIND_UP, ke.code, ke.shiftKey, 0, 0, false);
  };
  private readonly onMouseMove = (e: Event): void => {
    const me = e as MouseEvent;
    const vp = this.viewport();
    const x = vp.width > 0 ? (me.clientX - vp.left) / vp.width : 0.5;
    const y = vp.height > 0 ? (me.clientY - vp.top) / vp.height : 0.5;
    this.moveTo(x, y);
  };
  private readonly onMouseDown = (e: Event): void => {
    if ((e as MouseEvent).button === 0) this.setButton(true);
  };
  private readonly onMouseUp = (e: Event): void => {
    if ((e as MouseEvent).button === 0) this.setButton(false);
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
      this.ring.push({ kind: 0, code: '', shift: false, x: 0, y: 0, down: false });
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
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('mousemove', this.onMouseMove);
    this.target.addEventListener('mousedown', this.onMouseDown);
    this.target.addEventListener('mouseup', this.onMouseUp);
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
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
    this.count = 0;
    this.pending.n = 0;
  }

  // Programmatic control --------------------------------------------------------------------

  press(code: string, opts?: { shift?: boolean }): void {
    this.enqueue(KIND_DOWN, code, opts?.shift ?? false, 0, 0, false);
  }

  release(code: string): void {
    this.enqueue(KIND_UP, code, false, 0, 0, false);
  }

  moveTo(x: number, y: number): void {
    this.enqueue(KIND_MOVE, '', false, clamp(x, 0, 1), clamp(y, 0, 1), false);
  }

  setButton(down: boolean): void {
    this.enqueue(KIND_BUTTON, '', false, 0, 0, down);
  }

  private enqueue(
    kind: number,
    code: string,
    shift: boolean,
    x: number,
    y: number,
    down: boolean,
  ): void {
    if (this.stopped || this.count >= RING) return;
    const r = this.ring[(this.head + this.count) % RING];
    r.kind = kind;
    r.code = code;
    r.shift = shift;
    r.x = x;
    r.y = y;
    r.down = down;
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

    this.autoRun(nowMs);
    this.flushSwingPeaks(nowMs);

    // Position.
    const dir = (this.held.has('ArrowRight') ? 1 : 0) - (this.held.has('ArrowLeft') ? 1 : 0);
    if (dir !== 0) {
      const c = this.config;
      if (this.shift) s.lean = clamp(s.lean + dir * c.leanRate * dt, -c.maxLean, c.maxLean);
      else s.lateral = clamp(s.lateral + dir * c.lateralRate * dt, -c.maxLateral, c.maxLateral);
    }

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
    if (r.kind === KIND_MOVE) {
      this.mouseX = r.x;
      this.mouseY = r.y;
      this.mouseMoved = true;
      this.moveCursor(this.selected);
    } else if (r.kind === KIND_BUTTON) {
      if (r.down) {
        this.mouseFistSide = this.selected;
        this.setFist(this.selected, true, nowMs);
      } else if (this.mouseFistSide) {
        this.setFist(this.mouseFistSide, false, nowMs);
        this.mouseFistSide = null;
      }
    } else if (r.kind === KIND_DOWN) {
      if (this.held.has(r.code)) return; // auto-repeat or double press
      this.held.add(r.code);
      this.shift = r.shift || this.held.has('ShiftLeft') || this.held.has('ShiftRight');
      this.keyDown(r.code, nowMs);
    } else {
      const wasHeld = this.held.delete(r.code);
      this.shift = r.shift || this.held.has('ShiftLeft') || this.held.has('ShiftRight');
      if (wasHeld) this.keyUp(r.code, nowMs);
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

  private keyDown(code: string, nowMs: number): void {
    const s = this.state;
    const c = this.config;
    switch (code) {
      case 'KeyA':
      case 'KeyD':
        this.selected = code === 'KeyA' ? 'left' : 'right';
        if (this.mouseMoved) this.moveCursor(this.selected);
        break;
      case 'KeyQ':
        this.setFist('left', !s.hands.left.closed, nowMs);
        break;
      case 'KeyE':
        this.setFist('right', !s.hands.right.closed, nowMs);
        break;
      case 'KeyU':
        if (!this.raisedBoth && this.raisedOne === null) {
          this.raisedOne = this.selected;
          this.emit({ type: 'ArmRaised', t: nowMs, hand: this.selected, both: false });
        }
        break;
      case 'KeyI':
        if (this.raisedOne !== null) {
          this.emit({ type: 'ArmLowered', t: nowMs, hand: this.raisedOne });
          this.raisedOne = null;
        }
        this.raisedBoth = true;
        this.emit({ type: 'ArmRaised', t: nowMs, hand: 'left', both: true });
        this.emit({ type: 'ArmRaised', t: nowMs, hand: 'right', both: true });
        break;
      case 'KeyT':
      case 'KeyB':
        if (this.throwStart < 0) {
          this.throwStart = nowMs;
          this.throwHand = this.selected;
          this.throwKey = code;
          this.throwStyle = code === 'KeyT' ? 'overarm' : 'underarm';
          this.emit({ type: 'ThrowWindup', t: nowMs, hand: this.throwHand });
        }
        break;
      case 'KeyS': {
        const speed = this.shift ? c.swingSpeed * 1.375 : c.swingSpeed;
        const height = (0.5 - this.mouseY) * 2;
        const plane = (0.5 - this.mouseY) * 0.8;
        this.emit({
          type: 'SwingStarted',
          t: nowMs,
          speed,
          height,
          direction: this.selected === 'left' ? -1 : 1,
        });
        const p = this.pending;
        if (p.n < MAX_PENDING) {
          p.at[p.n] = nowMs + c.swingPeakDelayMs;
          p.speed[p.n] = speed;
          p.height[p.n] = height;
          p.plane[p.n] = plane;
          p.n++;
        }
        break;
      }
      case 'KeyR':
        this.doStep(nowMs, nowMs);
        break;
      case 'ArrowUp':
        this.autoActive = true;
        this.autoNext = nowMs;
        break;
      case 'ArrowDown':
        s.lateral = 0;
        s.lean = 0;
        break;
      case 'KeyP':
        this.emit({ type: 'Punch', t: nowMs, hand: this.selected, speed: PUNCH_SPEED });
        this.pulse(this.selected, nowMs, PUNCH_SPEED);
        break;
      case 'KeyK':
        this.squatting = true;
        this.emit({ type: 'Squat', t: nowMs, depth: SQUAT_DEPTH });
        break;
      case 'KeyJ':
        this.jumpStart = nowMs;
        this.emit({ type: 'Jump', t: nowMs, height: JUMP_HEIGHT });
        break;
      default:
        break;
    }
  }

  private keyUp(code: string, nowMs: number): void {
    const c = this.config;
    switch (code) {
      case 'KeyU':
        if (this.raisedOne !== null) {
          this.emit({ type: 'ArmLowered', t: nowMs, hand: this.raisedOne });
          this.raisedOne = null;
        }
        break;
      case 'KeyI':
        if (this.raisedBoth) {
          this.raisedBoth = false;
          this.emit({ type: 'ArmLowered', t: nowMs, hand: 'left' });
          this.emit({ type: 'ArmLowered', t: nowMs, hand: 'right' });
        }
        break;
      case 'KeyT':
      case 'KeyB':
        if (this.throwStart >= 0 && code === this.throwKey) {
          const charge = clamp((nowMs - this.throwStart) / c.throwChargeMs, 0, 1);
          const speed = c.throwMinSpeed + (c.throwMaxSpeed - c.throwMinSpeed) * charge;
          const lateral = (this.mouseX - 0.5) * 4;
          const loft =
            this.throwStyle === 'overarm' ? clamp((0.5 - this.mouseY) * 1.6 + 0.6, 0, 1.4) : 0.3;
          const curvature =
            (this.held.has('KeyC') ? c.curve : 0) - (this.held.has('KeyZ') ? c.curve : 0);
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
        break;
      case 'KeyK':
        this.squatting = false;
        break;
      case 'ArrowUp':
        this.autoActive = false;
        break;
      default:
        break;
    }
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
    if (!this.autoActive) return;
    const rate = this.shift ? 4.5 : this.config.autoRunStepsPerSecond;
    const interval = 1000 / rate;
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
    if (since >= STEP_DECAY_MS && !this.autoActive) {
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

    for (const side of ['left', 'right'] as const) {
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
      const shX = midX - (sg * 0.5 * sw * cosL) / ASPECT;
      const shY = midY - sg * 0.5 * sw * sinL;
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
