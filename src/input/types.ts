/**
 * Shared contract for the input layer. Types only.
 *
 * Sports consume an `InputProvider`: continuous signals as in-place state, discrete moments as
 * events. Two implementations exist: `TrackedInput` (landmark source -> filters -> kinematics ->
 * recognizers) and `DebugInput` (keyboard and mouse). Sports never read raw landmarks for
 * gesture logic.
 *
 * Units:
 * - Positions are mirrored normalised image coordinates (see src/tracking/types.ts).
 * - "sw" means shoulder widths: lengths divided by the player's 2D shoulder width, so values do
 *   not depend on body size or camera distance. Speeds are sw per second.
 * - Angles are radians.
 * - `t` is game ms.
 */

import type { LandmarkSource, TrackerNeeds } from '../tracking/types';

export type Side = 'left' | 'right';

export interface HandState {
  /** The hand is being tracked right now. */
  present: boolean;
  /** `closed` has been classified at least once; false means "show me your hand". */
  known: boolean;
  /** Debounced fist state. Keeps its last known value while the hand is not present. */
  closed: boolean;
  /** Raw curl metric: mean fingertip-to-wrist distance over palm size. About 0.8 fist, 1.8 open. */
  curl: number;
  /** Palm centre, mirrored normalised image coordinates, filtered. */
  x: number;
  y: number;
  /** Palm centre velocity, sw per second (hand widths * k when no pose is tracked). */
  vx: number;
  vy: number;
}

export type FrameProblem =
  'none' | 'lost' | 'move-left' | 'move-right' | 'step-back' | 'step-closer' | 'hands-out-of-view';

export interface ArmState {
  /** Wrist velocity, sw per second, 2D, least-squares over the last few filtered samples. */
  vx: number;
  vy: number;
  speed: number;
  /** Interior elbow angle, radians (pi = straight). */
  elbowAngle: number;
  /** d(elbowAngle)/dt, radians per second; positive while extending. */
  elbowRate: number;
  /** Wrist relative to the same-side shoulder, sw. x positive toward screen right, y positive UP. */
  wristX: number;
  wristY: number;
}

export interface Cadence {
  /** Knee lifts per second, smoothed; 0 when standing still. */
  stepsPerSecond: number;
  /** Mean knee-lift height over the last steps, sw. */
  amplitude: number;
}

/** Continuous input, mutated in place once per tracking frame. Do not hold references to copies. */
export interface InputState {
  /** Time of the newest tracking frame folded into this state. */
  t: number;
  /** Time of the frame before it (for interpolation); equals `t` until two frames have arrived. */
  tPrev: number;
  /** A body (or, for hands-only sports, at least one hand) is currently tracked. */
  tracking: boolean;
  problem: FrameProblem;
  /** Image width / height of the source. */
  aspect: number;
  /** Filtered pose, POSE_COUNT * POSE_STRIDE, off-image landmarks have visibility 0. */
  pose: Float32Array;
  /** The filtered pose one tracking frame earlier. */
  posePrev: Float32Array;
  /** True when `pose` holds meaningful data (false for hands-only tracking). */
  hasPose: boolean;
  /** 2D shoulder width in aspect-corrected normalised units. 0 until measured. */
  shoulderWidth: number;
  hands: { left: HandState; right: HandState };
  arms: { left: ArmState; right: ArmState };
  /** Torso lean from vertical, radians; positive leans toward screen right. */
  lean: number;
  /** Shoulder-midpoint x offset from the calibrated centre, sw; positive is screen right. */
  lateral: number;
  /** Hip-midpoint height change from the calibrated standing height, sw; positive is UP. */
  rise: number;
  cadence: Cadence;
}

/** Captured during onboarding; used to normalise and to detect drifting out of frame. */
export interface Calibration {
  /** Shoulder-midpoint position while standing in the guide, mirrored normalised. */
  centreX: number;
  centreY: number;
  /** Hip-midpoint y while standing. */
  hipY: number;
  /** Aspect-corrected normalised units. */
  shoulderWidth: number;
  /** Shoulder-to-wrist length with the arm straight, sw. */
  armLength: number;
  /** The throwing / dominant hand. */
  handedness: Side;
  seated: boolean;
}

/**
 * Discrete gesture events. Allocated when they fire (rare), never per frame.
 * `t` is the game-ms time of the moment itself (for peaks, the peak, not the detection time).
 */
export type GameEvent =
  | { type: 'FistClosed'; t: number; hand: Side }
  | { type: 'FistOpened'; t: number; hand: Side }
  /** Wrist held above shoulder height by a margin for a short dwell. `both` when both are up. */
  | { type: 'ArmRaised'; t: number; hand: Side; both: boolean }
  | { type: 'ArmLowered'; t: number; hand: Side }
  /** One knee lift during running in place. */
  | { type: 'Step'; t: number; side: Side; amplitude: number }
  /** Arm drawn back ready to throw or bowl. */
  | { type: 'ThrowWindup'; t: number; hand: Side }
  /**
   * Released at the wrist-speed peak.
   * speed: peak wrist speed, sw/s. lateral: wrist x relative to the shoulder midpoint at
   * release, sw, positive screen right. loft: 2D path angle at release, 0 horizontal, positive
   * upward. curvature: signed curvature of the wrist path over the last ~150 ms, 1/sw,
   * positive curving toward screen right. style: overarm when the wrist is above the shoulder.
   */
  | {
      type: 'ThrowReleased';
      t: number;
      hand: Side;
      speed: number;
      lateral: number;
      loft: number;
      curvature: number;
      style: 'overarm' | 'underarm';
    }
  /** Two-handed swing onset. height: wrists relative to shoulder line, sw, positive up. */
  | { type: 'SwingStarted'; t: number; speed: number; height: number; direction: -1 | 1 }
  /** plane: angle of the swing path from horizontal, radians, positive rising. */
  | { type: 'SwingPeak'; t: number; speed: number; height: number; plane: number }
  | { type: 'Punch'; t: number; hand: Side; speed: number }
  | { type: 'Squat'; t: number; depth: number }
  | { type: 'Jump'; t: number; height: number }
  | { type: 'TrackingLost'; t: number }
  | { type: 'TrackingFound'; t: number };

export type GameEventType = GameEvent['type'];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type Unsubscribe = () => void;

export interface InputProvider {
  readonly state: InputState;
  /** The landmark source behind this provider, or null for debug input. */
  readonly source: LandmarkSource | null;
  start(needs: TrackerNeeds): Promise<void>;
  setNeeds(needs: TrackerNeeds): Promise<void>;
  setCalibration(calibration: Calibration | null): void;
  /** Call once per rendered frame before the sport updates. Pumps the source. */
  update(nowMs: number): void;
  on<T extends GameEventType>(type: T, handler: (event: GameEventOf<T>) => void): Unsubscribe;
  onAny(handler: (event: GameEvent) => void): Unsubscribe;
  stop(): void;
}
