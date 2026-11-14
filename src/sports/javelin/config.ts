import type { TunableRange } from '../../core/sport';

/** Every threshold, timing and scoring constant of the javelin lives here (tunables panel). */
export const javelinConfig = {
  // Rounds
  attempts: 3,
  shortAttempts: 1,

  // Runway
  runwayLength: 32,
  /** Running this far past the line without throwing is a foul, metres. */
  overrun: 0.3,
  /**
   * A throw is reported 150 to 300 ms after the release. Crossing the line is only a foul after
   * this long past it with no throw, so a release just before the line is not lost to latency, s.
   */
  crossGraceS: 0.45,
  /** The "Throw!" hint appears inside this distance to the line, metres. */
  throwZone: 9,

  // Start gesture
  /** Throws are ignored this long after the start (lowering the arm can look like a throw), ms. */
  throwLockoutMs: 500,
  /** After the start, lowering the throwing arm within this window extends the lockout, ms. */
  lowerWindowMs: 3500,
  /** A raised arm with a known open hand starts the run after this hold, ms. */
  openHandHoldMs: 600,

  // Run speed
  maxRunSpeed: 9,
  fullCadence: 4,
  fullAmplitude: 0.45,
  /** Soft cap: linear up to this fraction of fullCadence, then asymptotic. */
  softCapKnee: 0.8,
  softCapMax: 1.15,
  minAmplitudeFactor: 0.75,
  accel: 6,
  decel: 3,
  /** After a release or a foul the athlete plants and stops at this rate, m/s^2. */
  plantDecel: 9,
  idleTimeoutS: 8,
  idleMoveM: 1,

  // Throw acceptance
  /** Wrist speed floor, sw/s (the recognizer's own minPeak). */
  minThrowSpeed: 2.5,
  acceptAnyStyle: true,
  /** Latency compensation never steps back further than this, s. */
  maxLatencyS: 1,
  /**
   * Raise the throw recognizer's body-speed limit (sw/s) for the duration of the sport; 0 leaves
   * recognizerConfig.throw.maxBodySpeed alone. Running in place bobs the shoulders.
   */
  maxBodySpeedOverride: 0,

  // Distance model
  baseSpeed: 9,
  runTransfer: 0.85,
  throwGain: 15,
  throwFloor: 2.5,
  throwCeil: 11,
  minAngle: 12,
  maxAngle: 52,
  angleCurve: 1,
  /**
   * The 2D release direction is only a proxy for loft (the player throws into the screen).
   * s = vy / speed in [-1, 1] maps from proxyLow (lowest angle) to proxyHigh (highest angle).
   * To be tuned by playtest.
   */
  proxyLow: -0.7,
  proxyHigh: 0.9,
  releaseHeight: 1.8,
  gravity: 9.81,
  /** Mild lift: effective gravity = gravity * gravityScale. */
  gravityScale: 0.94,
  /** Launch speed efficiency = 1 - effK * (angle - effCenter)^2 (throwing steeply costs speed). */
  effCenter: 25,
  effK: 0.00032,

  // Timing
  betweenAttemptsMs: 2600,
  finishDelayMs: 1500,

  // Camera
  cameraBack: 4.2,
  cameraUp: 2.3,
  cameraFov: 58,
  cameraLookAhead: 10,
  cameraLookY: 0.4,
  cameraSmooth: 3.2,
  fogNear: 60,
  fogFar: 280,

  // Bot
  /** Seconds from the moment the bot starts its throw to the release (raise, cock, throw). */
  botThrowLeadS: 1.25,
  /** The cadence recognizer keeps reporting the old cadence this long after the last step, s. */
  botCadenceHoldS: 0.8,
  botMarginM: 0.5,
};

export type JavelinConfig = typeof javelinConfig;

export const javelinRanges: Record<string, TunableRange> = {
  runwayLength: { min: 15, max: 60, step: 1 },
  throwZone: { min: 3, max: 20, step: 0.5 },
  throwLockoutMs: { min: 0, max: 1500, step: 50 },
  openHandHoldMs: { min: 200, max: 2000, step: 50 },
  maxRunSpeed: { min: 3, max: 14, step: 0.5 },
  fullCadence: { min: 2, max: 6, step: 0.1 },
  fullAmplitude: { min: 0.1, max: 1, step: 0.01 },
  accel: { min: 1, max: 20, step: 0.5 },
  decel: { min: 0.5, max: 20, step: 0.5 },
  minThrowSpeed: { min: 1, max: 8, step: 0.1 },
  maxBodySpeedOverride: { min: 0, max: 12, step: 0.5 },
  baseSpeed: { min: 0, max: 20, step: 0.5 },
  runTransfer: { min: 0, max: 1.5, step: 0.05 },
  throwGain: { min: 0, max: 30, step: 0.5 },
  throwFloor: { min: 0, max: 8, step: 0.1 },
  throwCeil: { min: 4, max: 20, step: 0.5 },
  minAngle: { min: 0, max: 45, step: 1 },
  maxAngle: { min: 20, max: 80, step: 1 },
  angleCurve: { min: 0.3, max: 3, step: 0.05 },
  proxyLow: { min: -1, max: 0.5, step: 0.05 },
  proxyHigh: { min: -0.5, max: 1, step: 0.05 },
  gravityScale: { min: 0.5, max: 1.2, step: 0.01 },
  effCenter: { min: 0, max: 50, step: 1 },
  effK: { min: 0, max: 0.002, step: 0.00005 },
  betweenAttemptsMs: { min: 500, max: 8000, step: 100 },
  cameraBack: { min: 1.5, max: 8, step: 0.1 },
  cameraUp: { min: 0.8, max: 5, step: 0.1 },
  cameraLookY: { min: 0, max: 2, step: 0.05 },
  cameraFov: { min: 35, max: 80, step: 1 },
  crossGraceS: { min: 0, max: 1.5, step: 0.05 },
  botThrowLeadS: { min: 0, max: 3, step: 0.05 },
  botCadenceHoldS: { min: 0, max: 2, step: 0.05 },
  botMarginM: { min: 0, max: 5, step: 0.1 },
};
