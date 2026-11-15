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

  // Start: there is no gesture. The run begins by itself after this get-ready beat, ms.
  readyMs: 1400,
  /** Throws are ignored this long after the run starts (a stray arm movement), ms. */
  throwLockoutMs: 400,

  // Run speed
  maxRunSpeed: 9,
  fullCadence: 4,
  fullAmplitude: 0.45,
  /** Soft cap: linear up to this fraction of fullCadence, then asymptotic. */
  softCapKnee: 0.8,
  softCapMax: 1.15,
  minAmplitudeFactor: 0.75,
  /** Quick to speed up (a step or two) and slower to slow down, m/s^2. */
  accel: 10,
  decel: 3,
  /** After a release or a foul the athlete plants and stops at this rate, m/s^2. */
  plantDecel: 9,
  idleTimeoutS: 8,
  idleMoveM: 1,
  /** Step events closer than this are one step (ms); further apart than stepMaxMs restarts. */
  stepMinMs: 140,
  stepMaxMs: 1100,
  /** Step rate ceiling, steps/s. */
  maxCadence: 5.5,
  /** How much of the newest step interval enters the step rate, 0..1 (1 = only the last step). */
  cadenceBlend: 0.6,
  /** The step rate is held this many intervals after the last step, then fades. */
  cadenceHoldFactor: 1.5,
  cadenceFadeMs: 450,

  // Throw acceptance
  /** Wrist speed floor for a throw when standing, sw/s (the recognizer's own minPeak is 2.5). */
  minThrowSpeed: 3,
  /** Added to the floor at full run speed, sw/s: arm pumping while running must not throw. */
  pumpMargin: 1.5,
  /** Mouse play: the run speed while the button is held, m/s (reached with `accel`). */
  mouseRunSpeed: 8,
  /** Mouse play: the step rate shown while running, steps/s (looks only). */
  mouseCadence: 4,
  /** Mouse play: a release sooner than this after running starts keeps running until then, ms. */
  mouseMinRunMs: 250,
  /** Mouse play: the fixed arm power of a release (wrist speed, sw/s; `throwCeil` is full power). */
  mouseThrowSpeed: 11,
  /** Mouse play: the fixed release angle, degrees. */
  mouseLoftDeg: 36,
  /** Only a throw with the wrist above the shoulder at the speed peak counts. */
  acceptAnyStyle: false,
  /** Latency compensation never steps back further than this, s. */
  maxLatencyS: 1,
  /**
   * Throw recognizer settings for the duration of the sport (restored afterwards); 0 leaves the
   * shared value alone. Running in place bobs the shoulders and pumps the arms, so the body-speed
   * limit is raised and the arm counts as ready at a higher wrist speed and after a shorter pause.
   */
  maxBodySpeedOverride: 6,
  recognizerArmSpeed: 2.2,
  recognizerArmMs: 50,

  // Distance model
  /** release speed = baseSpeed + runGain * run/maxRunSpeed + throwGain * armPower, m/s */
  baseSpeed: 9,
  runGain: 8.5,
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
  /** At full run speed the field of view widens by this many degrees and the camera drops back. */
  cameraSpeedFov: 9,
  cameraSpeedBack: 1.2,
  fogNear: 60,
  fogFar: 280,

  // Bot
  /** Seconds from the moment the bot starts its throw to the release (raise, cock, throw). */
  botThrowLeadS: 1.25,
  /** The cadence recognizer keeps reporting the old cadence this long after the last step, s. */
  botCadenceHoldS: 0.8,
  botMarginM: 0.5,
  /** Bot step rates, steps/s: the fixed rates of the slow and fast variants (?botRun=). */
  botSlowCadence: 2.4,
  botFastCadence: 4.4,
};

export type JavelinConfig = typeof javelinConfig;

export const javelinRanges: Record<string, TunableRange> = {
  runwayLength: { min: 15, max: 60, step: 1 },
  throwZone: { min: 3, max: 20, step: 0.5 },
  readyMs: { min: 300, max: 4000, step: 100 },
  throwLockoutMs: { min: 0, max: 1500, step: 50 },
  maxRunSpeed: { min: 3, max: 14, step: 0.5 },
  fullCadence: { min: 2, max: 6, step: 0.1 },
  fullAmplitude: { min: 0.1, max: 1, step: 0.01 },
  accel: { min: 1, max: 20, step: 0.5 },
  decel: { min: 0.5, max: 20, step: 0.5 },
  cadenceBlend: { min: 0.1, max: 1, step: 0.05 },
  cadenceHoldFactor: { min: 1, max: 3, step: 0.1 },
  cadenceFadeMs: { min: 100, max: 1500, step: 50 },
  minThrowSpeed: { min: 1, max: 8, step: 0.1 },
  pumpMargin: { min: 0, max: 5, step: 0.1 },
  mouseRunSpeed: { min: 3, max: 12, step: 0.5 },
  mouseCadence: { min: 1, max: 6, step: 0.1 },
  mouseMinRunMs: { min: 0, max: 1000, step: 50 },
  mouseThrowSpeed: { min: 4, max: 14, step: 0.5 },
  mouseLoftDeg: { min: 12, max: 52, step: 1 },
  maxBodySpeedOverride: { min: 0, max: 12, step: 0.5 },
  recognizerArmSpeed: { min: 0, max: 5, step: 0.1 },
  recognizerArmMs: { min: 0, max: 300, step: 10 },
  baseSpeed: { min: 0, max: 20, step: 0.5 },
  runGain: { min: 0, max: 20, step: 0.5 },
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
  cameraSpeedFov: { min: 0, max: 20, step: 1 },
  cameraSpeedBack: { min: 0, max: 4, step: 0.1 },
  crossGraceS: { min: 0, max: 1.5, step: 0.05 },
  botThrowLeadS: { min: 0, max: 3, step: 0.05 },
  botCadenceHoldS: { min: 0, max: 2, step: 0.05 },
  botMarginM: { min: 0, max: 5, step: 0.1 },
};
