import type { TunableRange } from '../../core/sport';

/** Every number the bowling rules and feel depend on. Registered with the tunables panel. */
export const bowlingConfig = {
  // Rounds
  frames: 10,
  shortFrames: 2,

  // Pickup
  /** Hold the hand still and low this long to pick up when the fist cannot be seen (ms). */
  pickupHoldMs: 1400,
  /** Wrist speed under this counts as still (sw/s). */
  pickupHoldSpeed: 0.8,
  /** Show the "show your hand" hint after this long without a fist reading (ms). */
  fistHintMs: 3000,

  // Aim
  /** Metres of approach per shoulder width of body offset. */
  lateralScale: 0.3,
  maxBowlerX: 0.45,
  /** Smoothing rate of the bowler position (1/s). */
  lateralSmooth: 8,
  /** Accept overarm-style throws too: from the front an underarm swing may finish high. */
  acceptAnyStyle: true as boolean,
  /** Slowest accepted release (sw/s). */
  minReleaseSpeed: 2.5,

  // Release mapping
  minBallSpeed: 4.5,
  maxBallSpeed: 9.5,
  speedFloor: 2.5,
  speedCeil: 8,
  /** Where the hanging wrist sits relative to the shoulder midpoint (sw). */
  neutralLateral: 0.62,
  /** Radians per sw of wrist offset from neutral. */
  aimGain: 0.025,
  maxAngle: 0.045,
  /** Half the shoulder span in sw: wrist-from-shoulder to wrist-from-midline. */
  aimShoulderHalf: 0.5,
  /** Smoothing rate of the live aim (1/s). Higher follows the hand faster. */
  aimSmooth: 9,
  /** The aim stops following the wrist once it moves faster than this (sw/s): a swing has begun. */
  aimFreezeSpeed: 1.2,
  /** After a wind-up the aim stays locked this long (s), or until the throw. */
  aimWindupHoldS: 2,
  /** Sideways acceleration (m/s^2) per unit of path curvature (1/sw). */
  hookGain: 0.35,
  maxHook: 0.7,
  /** Fraction of the lane travelled before the hook starts to bite. */
  hookStart: 0.55,

  // Ball and pins
  ballMass: 6.5,
  pinMass: 1.55,
  laneFriction: 0.08,
  pinFriction: 0.5,
  ballFriction: 0.08,
  pinRestitution: 0.5,
  ballRestitution: 0.2,
  pinLinearDamping: 0.05,
  pinAngularDamping: 0.1,
  /** Damping applied to the ball once it is in the pit. */
  pitDamping: 4,
  solverIterations: 8,

  // Settling
  pinSlowLinear: 0.15,
  pinSlowAngular: 0.5,
  /** Pins must be still this long to end a roll (s). */
  settleRestS: 0.4,
  /** Earliest the rest test may end a roll after first pin contact (s), so the first hit can start. */
  settleMinS: 0.35,
  /** Hard cap from first pin contact to the verdict (s). All ten down ends it at once. */
  settleTimeoutS: 2.5,
  /** A ball that passed the pins without touching one is called a miss or gutter after this (s). */
  missResolveS: 0.15,
  releaseTimeoutS: 10,
  /** A pin tilted more than this (degrees) from upright is down. */
  downTiltDeg: 35,

  // Pacing
  settleHoldS: 1.7,
  resetS: 1.1,
  finishDelayS: 1.2,
  powerMeterS: 1.5,

  // Camera
  cameraFov: 32,
  cameraBack: 4.8,
  cameraHeight: 2.25,
} satisfies Record<string, number | boolean>;

export type BowlingConfig = typeof bowlingConfig;

export const bowlingRanges: Record<string, TunableRange> = {
  pickupHoldMs: { min: 400, max: 4000, step: 50 },
  pickupHoldSpeed: { min: 0.2, max: 2, step: 0.05 },
  lateralScale: { min: 0.1, max: 0.6, step: 0.01 },
  minReleaseSpeed: { min: 1, max: 6, step: 0.1 },
  minBallSpeed: { min: 2, max: 9, step: 0.1 },
  maxBallSpeed: { min: 5, max: 14, step: 0.1 },
  speedFloor: { min: 1, max: 6, step: 0.1 },
  speedCeil: { min: 4, max: 14, step: 0.1 },
  neutralLateral: { min: 0, max: 1.5, step: 0.01 },
  aimGain: { min: 0, max: 0.3, step: 0.005 },
  maxAngle: { min: 0, max: 0.3, step: 0.005 },
  hookGain: { min: 0, max: 4, step: 0.05 },
  maxHook: { min: 0, max: 3, step: 0.05 },
  hookStart: { min: 0, max: 0.95, step: 0.01 },
  laneFriction: { min: 0, max: 0.5, step: 0.01 },
  aimSmooth: { min: 2, max: 30, step: 0.5 },
  aimWindupHoldS: { min: 0.3, max: 5, step: 0.1 },
  aimFreezeSpeed: { min: 0.3, max: 4, step: 0.1 },
  settleRestS: { min: 0.1, max: 1.5, step: 0.05 },
  settleMinS: { min: 0, max: 1, step: 0.05 },
  settleTimeoutS: { min: 1, max: 8, step: 0.1 },
  missResolveS: { min: 0, max: 1, step: 0.05 },
  downTiltDeg: { min: 15, max: 80, step: 1 },
};
