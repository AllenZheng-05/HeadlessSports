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

  // Mouse play (camera off): fixed speed, no hook, the arrows aim at the cursor
  /** Ball speed for every mouse throw, whatever the hold time (m/s). */
  mouseBallSpeed: 7.5,
  /** A tap still gets this much back-swing before the ball goes (s). */
  mouseWindupMinS: 0.25,
  /** The arrows never aim at a point nearer than this down the lane (m), so a cursor close to the bowler is not a huge turn. */
  mouseAimMinDist: 8,

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
  /** A standing pin tilted beyond this (degrees) must be nearly motionless to count as settled. */
  wobbleTiltDeg: 4,
  wobbleSlowLinear: 0.03,
  wobbleSlowAngular: 0.12,
  /** A moving fallen pin or ball within this distance (m) of a standing pin holds the verdict. */
  reachDist: 0.7,
  /** Speed (m/s) above which a fallen pin or the ball counts as moving for the reach test. */
  reachSpeed: 0.25,
  /** A pin tipped past this angle (degrees) lies flat and gets the damping below, so it stops rolling. */
  flatTiltDeg: 70,
  flatLinearDamping: 4,
  flatAngularDamping: 6,
  /** A standing pin slower than this (m/s; angular is 25x) is settling and gets the damping below. */
  settleEnterSpeed: 0.3,
  settleLinearDamping: 3,
  settleAngularDamping: 3,
  /** Pins must be still this long to end a roll (s). */
  settleRestS: 0.4,
  /** Earliest the rest test may end a roll after first pin contact (s), so the first hit can start. */
  settleMinS: 0.35,
  /** Last-resort cap from first pin contact to the verdict (s). All ten down ends it at once. */
  settleTimeoutS: 6,
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

  // Tutorial
  /** Feedback for a step shows only after this long on it (ms). */
  tutorialHintDelayMs: 2500,
  /** The body must stay tracked this long for the first step (ms). */
  tutorialTrackedMs: 600,
  /** The arrows count as lined up once they have swept this far (radians). */
  tutorialAimSpreadRad: 0.012,
  /** Or once the bowler has stepped this far sideways (m). */
  tutorialStepM: 0.12,
  /** A hook below this (m/s^2) gets the "curve more" hint. */
  tutorialHookMin: 0.05,

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
  mouseBallSpeed: { min: 4.5, max: 9.5, step: 0.1 },
  mouseWindupMinS: { min: 0.1, max: 0.8, step: 0.01 },
  mouseAimMinDist: { min: 2, max: 15, step: 0.5 },
  hookGain: { min: 0, max: 4, step: 0.05 },
  maxHook: { min: 0, max: 3, step: 0.05 },
  hookStart: { min: 0, max: 0.95, step: 0.01 },
  laneFriction: { min: 0, max: 0.5, step: 0.01 },
  aimSmooth: { min: 2, max: 30, step: 0.5 },
  aimWindupHoldS: { min: 0.3, max: 5, step: 0.1 },
  aimFreezeSpeed: { min: 0.3, max: 4, step: 0.1 },
  wobbleTiltDeg: { min: 0, max: 20, step: 0.5 },
  wobbleSlowLinear: { min: 0, max: 0.2, step: 0.005 },
  wobbleSlowAngular: { min: 0, max: 0.5, step: 0.01 },
  reachDist: { min: 0.2, max: 1.5, step: 0.05 },
  reachSpeed: { min: 0.05, max: 1, step: 0.05 },
  flatTiltDeg: { min: 40, max: 89, step: 1 },
  flatLinearDamping: { min: 0, max: 8, step: 0.1 },
  flatAngularDamping: { min: 0, max: 12, step: 0.1 },
  settleEnterSpeed: { min: 0.05, max: 1, step: 0.05 },
  settleLinearDamping: { min: 0, max: 15, step: 0.5 },
  settleAngularDamping: { min: 0, max: 15, step: 0.5 },
  settleRestS: { min: 0.1, max: 1.5, step: 0.05 },
  settleMinS: { min: 0, max: 1, step: 0.05 },
  settleTimeoutS: { min: 1, max: 8, step: 0.1 },
  missResolveS: { min: 0, max: 1, step: 0.05 },
  downTiltDeg: { min: 15, max: 80, step: 1 },
  tutorialHintDelayMs: { min: 500, max: 8000, step: 100 },
  tutorialTrackedMs: { min: 200, max: 3000, step: 100 },
  tutorialAimSpreadRad: { min: 0.002, max: 0.04, step: 0.001 },
  tutorialStepM: { min: 0.02, max: 0.4, step: 0.01 },
  tutorialHookMin: { min: 0, max: 0.7, step: 0.01 },
};
