/**
 * The programmatic mouse API of the camera-off input (`DebugInput`). A sport that wants a one-button
 * mouse scheme (press, hold, release, move) gets an instance with `asMouseControl(ctx.input)`; it
 * returns null for tracked input, so the same sport code runs on both.
 *
 * Every action is queued and applied at the start of the next `DebugInput.update`, so
 * events carry that update's time. Nothing here allocates.
 */
import type { InputProvider, Side } from '../types';

export type ThrowStyle = 'overarm' | 'underarm';

/** Optional release values. Omitted ones are derived from the pointer. */
export interface ThrowOptions {
  /** Radians above horizontal. */
  loft?: number;
  /** Sideways aim in shoulder widths, negative to screen left. */
  lateral?: number;
  /** Curve of the throw; positive curves right. */
  curvature?: number;
}

export interface MouseControl {
  readonly mouseControl: true;

  // Pointer state. Only presses on the game count (see `isUiTarget` in DebugInput).
  /** Mouse position as a mirrored-image position, 0..1 over the viewport (hand x / y space). */
  readonly pointerX: number;
  readonly pointerY: number;
  /** True while the button is down. */
  readonly pointerDown: boolean;
  /** Monotonic count of presses. */
  readonly pointerPresses: number;
  /** Monotonic count of releases (only of presses that were counted). */
  readonly pointerReleases: number;
  /** Game ms the button has been down, as of the last update; 0 when up. */
  readonly pointerHeldMs: number;
  /** The hand the mouse moves. */
  readonly selectedHand: Side;

  /** On: the mouse button has no built-in effect (no fist close); the sport decides. Off by default. */
  setManualMode(on: boolean): void;
  /** Mouse movement moves the selected hand (default true). False: the sport places hands itself. */
  setPointerFollow(follow: boolean): void;
  /** Choose the mouse-driven hand; it jumps under the pointer when following. */
  selectHand(side: Side): void;
  /** Place a hand at a mirrored-image position (0..1). */
  setHandTarget(side: Side, x: number, y: number): void;
  /** Open or close a hand (FistClosed / FistOpened). */
  setHandClosed(side: Side, closed: boolean): void;

  /** Start a throw wind-up (ThrowWindup). Default hand is the selected one, default style overarm. */
  startWindup(side?: Side, style?: ThrowStyle): void;
  /**
   * Release the wind-up (ThrowReleased). `power` 0..1 sets the speed; omitted, it is the time
   * since `startWindup` over the charge time. No-op when there is no wind-up.
   */
  releaseThrow(power?: number, opts?: ThrowOptions): void;
  /** Wind-up and release in one update. */
  throwNow(power: number, opts?: ThrowOptions & { hand?: Side; style?: ThrowStyle }): void;
  /** A swing (SwingStarted, then SwingPeak shortly after). `power` 0..1, `height` -1..1. */
  swing(opts?: { power?: number; height?: number; direction?: -1 | 1 }): void;
  /** Run continuously at this many steps per second (Step events, leg motion, cadence). 0 stops. */
  setRunCadence(stepsPerSecond: number): void;
  /** One running step, alternating legs. */
  step(): void;
  /** Raise one arm, both arms, or lower them (ArmRaised / ArmLowered). */
  setArmsRaised(which: 'none' | Side | 'both'): void;
  /** A punch (Punch) with a hand, default the selected one. */
  punch(side?: Side): void;
  /** Squat while true. */
  setSquat(on: boolean): void;
  jump(): void;
  /** Sideways position in shoulder widths (clamped). */
  setLateral(sw: number): void;
  /** Lean in radians (clamped). */
  setLean(rad: number): void;
  /** Lateral and lean back to 0. */
  recentre(): void;
}

/** The mouse API when the input is the camera-off provider, else null. */
export function asMouseControl(input: InputProvider | null | undefined): MouseControl | null {
  const m = input as Partial<MouseControl> | null | undefined;
  return m !== null && m !== undefined && m.mouseControl === true ? (m as MouseControl) : null;
}
