import type { TunableRange } from '../../core/sport';

/** Every threshold, timing and scoring constant of pitching lives here (tunables panel). */
export const pitchingConfig = {
  // Rounds
  pitches: 10,
  shortPitches: 3,

  // The catcher's call and the rhythm of a pitch. Nothing here is a countdown: the player takes
  // as long as they need once the call has been up for callReactMs.
  /** The catcher sets up (mitt moves to the called spot) before the call appears, ms. */
  callSetupMs: 900,
  /** The call is up this long before a selection is accepted, so there is time to read it, ms. */
  callReactMs: 2600,
  /** Extra setup before the very first call, ms. */
  firstPitchExtraMs: 1500,
  /** With ?short=1 every gap above and betweenPitchesMs is multiplied by this. */
  shortGapScale: 0.3,
  /** Chance that the catcher calls a curve (otherwise a fastball). */
  curveShare: 0.45,

  // Pitch selection (a slow, still moment, so hand state is allowed)
  /** The throwing wrist counts as still below this speed, sw/s. */
  signStillSpeed: 0.8,
  /** The hand must be still and read the same for this long to pick a pitch, ms. */
  signHoldMs: 900,
  /** Total stillness with an unknown or missing hand before the fastball is picked for you, ms. */
  signFallbackMs: 5000,
  /** Throws are ignored this long after the pitch is picked (settling the arm), ms. */
  throwLockoutMs: 400,

  // Pitch timing
  /** No throw within this long after the wind-up starts is a balk, s. */
  pitchClockS: 20,
  /** The result is shown this long before the next pitch, ms. */
  betweenPitchesMs: 1800,

  // Throw acceptance
  /** Wrist speed floor, sw/s (the recognizer's own minPeak). */
  minThrowSpeed: 2.5,
  acceptAnyStyle: true,

  // Where the pitch goes. Aim comes from the 2D release only: never depth.
  /** Wrist x relative to the shoulder midpoint for a natural straight throw, sw (per side). */
  neutralLateral: 0.62,
  /** Metres of pitch location per shoulder width of release offset. */
  aimGainX: 0.55,
  /** Largest sideways miss before the zone assist and the curve break, m. */
  maxMiss: 0.9,
  /**
   * The release height proxy s = vy / speed maps linearly from proxyLow (lowest) to proxyHigh
   * (highest). Measured for the synthetic overarmThrow at loftDeg 60 and 110 (see sequence.test.ts).
   * MUST be tuned on real recordings.
   */
  proxyLow: -0.45,
  proxyHigh: 0.36,
  /** Keyboard-and-mouse throws report vy / speed in 0 to 1 (mouse centre about 0.57). */
  debugProxyLow: 0.1,
  debugProxyHigh: 1,
  /** Height range around the zone centre, m. */
  heightRange: 0.55,
  /** Curveball break, m: down, and toward the glove side (away from the throwing hand). */
  curveDrop: 0.22,
  curveSide: 0.12,
  /** Extra sideways break per unit of release path curvature (1/sw). 0 leaves it off. */
  curvatureGain: 0,
  curveSpeedFactor: 0.8,
  // Live aim (the indicator). Release uses the same value the indicator showed.
  /** Held wrist height relative to the shoulder (sw) that maps to the lowest and highest aim. */
  holdAimLow: -0.6,
  holdAimHigh: 0.9,
  /** Below this wrist speed the indicator's height follows where the wrist is held, sw/s. */
  blendSpeedLow: 1,
  /** Smoothing time constant of the indicator while the arm is slow, ms. */
  aimSmoothMs: 160,
  /** At or above this fraction of minThrowSpeed the indicator is not smoothed at all. */
  aimFastFraction: 0.4,
  /** Keyboard and mouse: lateral of a mouse at screen centre, and sw per window width. */
  debugNeutralLateral: 0.62,
  debugMouseLateral: 4,
  /** The scored location is pulled this fraction of the way toward the lit cell's centre. */
  assist: 0.35,

  // Speed
  speedFloor: 2.5,
  speedCeil: 9,
  minKmh: 55,
  maxKmh: 120,
  /** Speed adds nothing to the score above this, km/h. Nice and easy does it. */
  scoredSpeedCapKmh: 95,

  // Strike zone (metres, in the plane over the plate)
  zoneWidth: 0.5,
  zoneHeight: 0.6,
  zoneCentreY: 0.8,
  /** A ball this close outside the zone edge is a near miss, m. */
  nearMiss: 0.15,

  // Scoring
  pointsExact: 10,
  pointsAdjacent: 5,
  pointsZone: 3,
  pointsNear: 1,
  speedBonusMax: 3,
  curveBonus: 2,
  /** Added to a pitch that is the called type and lands in the zone. */
  calledBonus: 3,
  /** A pitch that is not the called type is a legal pitch, but its points are multiplied by this. */
  wrongPitchFactor: 0.5,

  // Flight
  /** Mound to plate, m. */
  plateDistance: 14,
  /** Flight time is distance / speed times this, so the ball can be followed by eye. */
  flightTimeScale: 1.6,
  /** A late event never starts the ball further along than this fraction of its flight. */
  maxLatencyFraction: 0.5,
  /** Where in the flight the curve starts to break, 0 to 1 (the break is complete at the plate). */
  curveBreakFrom: 0.55,

  // Look
  /** The zone and plate are drawn this much larger than life so they read from the mound. */
  zoneVisualScale: 4,
  /** Height of the drawn zone's centre, m (the scored zone stays at zoneCentreY). */
  zoneDrawCentreY: 1.5,
  catcherScale: 2.3,
  /** World height the speech bubble's tail points at, above the catcher, m. */
  bubbleHeight: 3.2,
  ballRadius: 0.14,
  cameraFov: 22,
  cameraBack: 3.6,
  cameraUp: 1.95,
  /** Camera shift toward the glove side so the pitcher does not hide the zone, m. */
  cameraSide: 0.9,
  cameraLookY: 1.4,
  fogNear: 40,
  fogFar: 220,

  // Bot (fitted on overarmThrow through runScript; see sequence.test.ts)
  botPowerLow: 0.6,
  botPowerHigh: 0.8,
  /** overarmThrow loftDeg that gives proxyLow and proxyHigh. */
  botLoftLow: 60,
  botLoftHigh: 110,
  /** Event lateral of the bot's natural line per side, sw (measured 0.4 to 0.6). */
  botNaturalLateral: 0.5,
  /** Event lateral per unit of the overarmThrow `lateral` option. */
  botLateralPerOption: 1,
};

export type PitchingConfig = typeof pitchingConfig;

export const pitchingRanges: Record<string, TunableRange> = {
  signStillSpeed: { min: 0.2, max: 3, step: 0.1 },
  callSetupMs: { min: 200, max: 3000, step: 100 },
  callReactMs: { min: 1500, max: 6000, step: 100 },
  firstPitchExtraMs: { min: 0, max: 4000, step: 100 },
  shortGapScale: { min: 0.05, max: 1, step: 0.05 },
  curveShare: { min: 0, max: 1, step: 0.05 },
  signHoldMs: { min: 200, max: 2000, step: 50 },
  signFallbackMs: { min: 1000, max: 10000, step: 100 },
  throwLockoutMs: { min: 0, max: 1500, step: 50 },
  pitchClockS: { min: 4, max: 30, step: 1 },
  betweenPitchesMs: { min: 500, max: 5000, step: 100 },
  minThrowSpeed: { min: 1, max: 8, step: 0.1 },
  neutralLateral: { min: 0, max: 1.5, step: 0.02 },
  aimGainX: { min: 0.1, max: 1.5, step: 0.05 },
  maxMiss: { min: 0.3, max: 2, step: 0.05 },
  proxyLow: { min: -1, max: 0.5, step: 0.05 },
  proxyHigh: { min: -0.5, max: 1, step: 0.05 },
  heightRange: { min: 0.1, max: 1.2, step: 0.05 },
  curveDrop: { min: 0, max: 0.6, step: 0.01 },
  curveSide: { min: 0, max: 0.6, step: 0.01 },
  curvatureGain: { min: 0, max: 1, step: 0.02 },
  curveSpeedFactor: { min: 0.5, max: 1, step: 0.01 },
  assist: { min: 0, max: 1, step: 0.05 },
  holdAimLow: { min: -1.5, max: 0.5, step: 0.05 },
  holdAimHigh: { min: 0, max: 2, step: 0.05 },
  blendSpeedLow: { min: 0.2, max: 2.5, step: 0.1 },
  aimSmoothMs: { min: 1, max: 600, step: 10 },
  aimFastFraction: { min: 0.1, max: 1, step: 0.05 },
  calledBonus: { min: 0, max: 10, step: 1 },
  wrongPitchFactor: { min: 0, max: 1, step: 0.05 },
  speedFloor: { min: 0, max: 8, step: 0.1 },
  speedCeil: { min: 4, max: 20, step: 0.5 },
  minKmh: { min: 30, max: 90, step: 1 },
  maxKmh: { min: 80, max: 160, step: 1 },
  scoredSpeedCapKmh: { min: 60, max: 130, step: 1 },
  nearMiss: { min: 0, max: 0.5, step: 0.01 },
  flightTimeScale: { min: 0.8, max: 3, step: 0.05 },
  maxLatencyFraction: { min: 0, max: 0.9, step: 0.05 },
  curveBreakFrom: { min: 0.2, max: 0.9, step: 0.05 },
  zoneVisualScale: { min: 1, max: 4, step: 0.1 },
  cameraFov: { min: 20, max: 60, step: 1 },
  cameraBack: { min: 1.5, max: 8, step: 0.1 },
  cameraUp: { min: 1, max: 4, step: 0.05 },
  cameraSide: { min: 0, max: 2.5, step: 0.05 },
  cameraLookY: { min: 0, max: 2, step: 0.05 },
  botLoftLow: { min: 30, max: 100, step: 1 },
  botLoftHigh: { min: 70, max: 140, step: 1 },
  botNaturalLateral: { min: 0, max: 1, step: 0.02 },
};
