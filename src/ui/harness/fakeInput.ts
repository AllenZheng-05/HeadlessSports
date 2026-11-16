import type {
  ArmState,
  GameEvent,
  GameEventOf,
  GameEventType,
  HandState,
  InputProvider,
  InputState,
  Side,
} from '../../input/types';
import type { LandmarkSource } from '../../tracking/types';

/**
 * A tiny stand-in input provider for the harness: the right hand follows the mouse, the mouse
 * button closes it. 'pose' mode also fills a skeleton; 'hands' mode is hands-only tracking.
 */
export interface FakeInput extends InputProvider {
  setMouse(nx: number, ny: number, down: boolean): void;
  /** Put one hand at a screen point (0..1), as the cursor will map it. */
  setHand(side: Side, nx: number, ny: number, down: boolean): void;
  /** Whether the fist classifier is confident about the hand (false: state unknown). */
  setKnown(side: Side, known: boolean): void;
  /** The hand is no longer tracked. */
  clearHand(side: Side): void;
  emit(event: GameEvent): void;
}

const ASPECT = 16 / 9;
const SW = 0.28;

function hand(): HandState {
  return { present: false, known: true, closed: false, curl: 1.8, x: 0.5, y: 0.5, vx: 0, vy: 0 };
}

function arm(): ArmState {
  return { vx: 0, vy: 0, speed: 0, elbowAngle: 3, elbowRate: 0, wristX: 0, wristY: 0 };
}

/**
 * `kind` 'camera' gives the input a camera-like source (hand cursor with hold-to-select); 'debug'
 * has no source, like mouse input (the cursor follows the real pointer).
 */
export function createFakeInput(
  mode: 'pose' | 'hands',
  kind: 'camera' | 'debug' = 'camera',
): FakeInput {
  const pose = new Float32Array(33 * 4);
  const smx = 0.5;
  const smy = 0.36;
  const half = SW / ASPECT / 2;
  const put = (i: number, x: number, y: number, vis = 1): void => {
    pose[i * 4] = x;
    pose[i * 4 + 1] = y;
    pose[i * 4 + 3] = vis;
  };
  put(11, smx - half, smy);
  put(12, smx + half, smy);
  put(13, smx - half - 0.03, smy + 0.15);
  put(15, smx - half - 0.04, smy + 0.28, 0.45);
  put(14, smx + half + 0.03, smy + 0.15);
  put(16, smx + half + 0.04, smy + 0.28);
  put(23, smx - half * 0.7, smy + 0.3);
  put(24, smx + half * 0.7, smy + 0.3);
  put(25, smx - half * 0.7, smy + 0.5);
  put(26, smx + half * 0.7, smy + 0.5);
  put(27, smx - half * 0.7, smy + 0.7);
  put(28, smx + half * 0.7, smy + 0.7);

  const state: InputState = {
    t: 0,
    tPrev: 0,
    tracking: true,
    problem: 'none',
    aspect: ASPECT,
    pose,
    posePrev: new Float32Array(33 * 4),
    hasPose: mode === 'pose',
    shoulderWidth: mode === 'pose' ? SW : 0,
    hands: { left: hand(), right: hand() },
    arms: { left: arm(), right: arm() },
    lean: 0,
    lateral: 0,
    rise: 0,
    cadence: { stepsPerSecond: 0, amplitude: 0 },
  };

  const setHand = (side: Side, nx: number, ny: number, down: boolean): void => {
    const hand = state.hands[side];
    hand.present = true;
    hand.known = true;
    hand.closed = down;
    if (mode === 'pose') {
      // inverse of the reach box, so the cursor lands exactly on the given point
      hand.x = smx + ((nx - 0.5) * SW * 3) / ASPECT;
      hand.y = smy - SW * (0.2 + (0.5 - ny) * 2.2);
      put(side === 'left' ? 15 : 16, hand.x, hand.y);
    } else {
      hand.x = Math.max(0, Math.min(1, 0.5 + (nx - 0.5) / 1.3));
      hand.y = Math.max(0, Math.min(1, 0.5 + (ny - 0.5) / 1.3));
    }
  };

  const handlers = new Map<string, Set<(e: GameEvent) => void>>();
  const any = new Set<(e: GameEvent) => void>();

  return {
    state,
    source:
      kind === 'camera' ? ({ kind: 'camera', video: null } as unknown as LandmarkSource) : null,
    start: () => Promise.resolve(),
    setNeeds: () => Promise.resolve(),
    setCalibration: () => undefined,
    update: (nowMs: number) => {
      state.tPrev = state.t;
      state.t = nowMs;
    },
    stop: () => undefined,
    on<T extends GameEventType>(type: T, handler: (event: GameEventOf<T>) => void) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      const fn = handler as (e: GameEvent) => void;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    onAny(handler) {
      any.add(handler);
      return () => {
        any.delete(handler);
      };
    },
    emit(event: GameEvent): void {
      for (const fn of handlers.get(event.type) ?? []) fn(event);
      for (const fn of any) fn(event);
    },
    setMouse(nx: number, ny: number, down: boolean): void {
      setHand('right', nx, ny, down);
    },
    setHand,
    setKnown(side: Side, known: boolean): void {
      state.hands[side].known = known;
    },
    clearHand(side: Side): void {
      const hand = state.hands[side];
      hand.present = false;
      hand.closed = false;
      if (mode === 'pose') pose[(side === 'left' ? 15 : 16) * 4 + 3] = 0;
    },
  };
}
