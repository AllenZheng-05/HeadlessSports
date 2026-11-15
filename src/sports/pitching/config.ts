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

  // Where the pitch goes. The glove hand places the ring; the throwing arm only steers a little.
  // Aim comes from 2D positions only: never depth.
  /** Glove wrist at rest-in-front-of-chest, relative to the shoulder midpoint, sw toward the glove side. */
  gloveNeutralX: 0.15,
  /** Glove wrist height relative to its shoulder at the neutral point, sw (up is positive). */
  gloveNeutralY: -0.35,
  /** Metres of pitch location per shoulder width of glove movement (about +-0.5 sw covers the zone). */
  gloveGainX: 1,
  gloveGainY: 1,
  /** Largest sideways miss before the zone assist and the curve break, m. */
  maxMiss: 0.9,
  /** Height range around the zone centre, m. */
  heightRange: 0.55,
  /** The glove wrist counts as tracked at or above this pose visibility, 0 to 1. */
  gloveMinVisibility: 0.5,
  /** Glove not tracked: the ring holds its last value this long, ms. */
  gloveGraceMs: 800,
  /** Then it eases to the centre of the zone with this time constant, ms. */
  gloveEaseMs: 500,
  /** The ring holds while the throwing wrist is at or above this speed, sw/s (below minThrowSpeed). */
  lockSpeed: 2,
  /** When the hold starts, the ring goes back this far to what it showed before the throw, ms. */
  lockBackMs: 100,
  /** A release the ring was not holding for uses the ring value this long before it, ms. */
  lockFallbackLeadMs: 350,
  /** Throwing-arm steering on top of the locked aim: m per sw of release offset from neutral. 0 turns it off. */
  steerGainX: 0.3,
  /** And per unit of the height proxy offset (m of proxy height, see heightRange). 0 turns it off. */
  steerGainY: 0.3,
  /** Steering never moves the pitch more than this on each axis, m. */
  steerMaxX: 0.15,
  steerMaxY: 0.15,
  /** Wrist x relative to the shoulder midpoint for a natural straight throw, sw (per side). */
  neutralLateral: 0.62,
  /**
   * The release height proxy s = vy / speed maps linearly from proxyLow (lowest) to proxyHigh
   * (highest). Measured for the synthetic overarmThrow at loftDeg 60 and 110 (see sequence.test.ts).
   * MUST be tuned on real recordings.
   */
  proxyLow: -0.45,
  proxyHigh: 0.36,
  /** Mouse throws report vy / speed in 0 to 1 (mouse centre about 0.57). */
  debugProxyLow: 0.1,
  debugProxyHigh: 1,
  /** Curveball break, m: down, and toward the glove side (away from the throwing hand). */
  curveDrop: 0.22,
  curveSide: 0.12,
  /** Extra sideways break per unit of release path curvature (1/sw). 0 leaves it off. */
  curvatureGain: 0,
  curveSpeedFactor: 0.8,
  /** Smoothing time constant of the ring while the glove is tracked, ms. */
  aimSmoothMs: 160,
  // Mouse play: no sign step and no power; a fixed good speed per pitch type.
  /** How long after the call appears a pitch can be thrown, ms (the buttons work from the call). */
  mouseReactMs: 700,
  /** Wrist speed standing in for the throw, sw/s (about 105 km/h as a fastball). */
  mouseFastballSpeed: 7.5,
  /** The curveball is also slowed by curveSpeedFactor (about 80 km/h). */
  mouseCurveSpeed: 7,
  /** The scored location is pulled this fraction of the way toward the lit cell's centre (light: the aim is deliberate). */
  assist: 0.15,

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
  mouseReactMs: { min: 0, max: 3000, step: 50 },
  mouseFastballSpeed: { min: 2.5, max: 12, step: 0.1 },
  mouseCurveSpeed: { min: 2.5, max: 12, step: 0.1 },
  signHoldMs: { min: 200, max: 2000, step: 50 },
  signFallbackMs: { min: 1000, max: 10000, step: 100 },
  throwLockoutMs: { min: 0, max: 1500, step: 50 },
  pitchClockS: { min: 4, max: 30, step: 1 },
  betweenPitchesMs: { min: 500, max: 5000, step: 100 },
  minThrowSpeed: { min: 1, max: 8, step: 0.1 },
  neutralLateral: { min: 0, max: 1.5, step: 0.02 },
  maxMiss: { min: 0.3, max: 2, step: 0.05 },
  gloveNeutralX: { min: -0.5, max: 0.8, step: 0.02 },
  gloveNeutralY: { min: -1, max: 0.5, step: 0.02 },
  gloveGainX: { min: 0.3, max: 2.5, step: 0.05 },
  gloveGainY: { min: 0.3, max: 2.5, step: 0.05 },
  gloveMinVisibility: { min: 0.1, max: 0.95, step: 0.05 },
  gloveGraceMs: { min: 0, max: 3000, step: 50 },
  gloveEaseMs: { min: 50, max: 2000, step: 50 },
  lockSpeed: { min: 0.8, max: 3, step: 0.1 },
  lockBackMs: { min: 0, max: 300, step: 10 },
  lockFallbackLeadMs: { min: 100, max: 800, step: 10 },
  steerGainX: { min: 0, max: 1, step: 0.02 },
  steerGainY: { min: 0, max: 1, step: 0.02 },
  steerMaxX: { min: 0, max: 0.5, step: 0.01 },
  steerMaxY: { min: 0, max: 0.5, step: 0.01 },
  proxyLow: { min: -1, max: 0.5, step: 0.05 },
  proxyHigh: { min: -0.5, max: 1, step: 0.05 },
  heightRange: { min: 0.1, max: 1.2, step: 0.05 },
  curveDrop: { min: 0, max: 0.6, step: 0.01 },
  curveSide: { min: 0, max: 0.6, step: 0.01 },
  curvatureGain: { min: 0, max: 1, step: 0.02 },
  curveSpeedFactor: { min: 0.5, max: 1, step: 0.01 },
  assist: { min: 0, max: 1, step: 0.05 },
  aimSmoothMs: { min: 1, max: 600, step: 10 },
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
