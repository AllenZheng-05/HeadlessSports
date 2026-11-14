import type { TunableRange } from '../../core/sport';

/** Every threshold, timing and scoring constant of archery. One mutable object, registered as tunables. */
export const archeryConfig = {
  // Round
  arrows: 6,
  shortArrows: 2,
  /** Camera dwell on the target after a hit, ms. */
  showHitMs: 1600,
  /** Pause between the last arrow's replay and the results screen, seconds. */
  finishDelayS: 1.2,

  // Bow arm
  /** Bow wrist must be at least this far from its shoulder, sw. */
  bowMinReach: 0.75,
  /** ... and no further than this above or below shoulder height, sw. */
  bowMaxDrop: 0.9,
  /** Lowering the bow arm this long while drawing puts the arrow back, ms. */
  bowDropMs: 600,

  // Aim
  /** Bow wrist x relative to its shoulder (outward positive), sw, that aims straight. */
  neutralX: 1.2,
  neutralY: 0,
  /** Radians per sw. */
  aimGainX: 0.25,
  aimGainY: 0.25,
  maxYaw: 0.2,
  minPitch: -0.08,
  maxPitch: 0.22,
  aimSmoothS: 0.12,
  /** Sway amplitude reached after holding at full draw for `swayRampS`, radians. */
  maxSwayRad: 0.012,
  swayRampS: 4,

  // Nock, draw, release
  /** Max distance between the wrists to nock, sw. */
  nockDistance: 0.9,
  /** A fist that closed this recently still nocks when the hands arrive, ms. */
  nockGraceMs: 500,
  /** Wrist distance (sw) that is 0% and 100% draw. */
  drawStart: 0.5,
  drawFull: 2.1,
  drawSmoothS: 0.08,
  /** Below this draw the arrow is put back instead of shot. */
  minDraw: 0.25,
  /** The shot uses draw and aim from this long before the open event, ms. */
  releaseLookbackMs: 120,
  /** Hand lost this long while drawing puts the arrow back, ms. */
  lostHandCancelMs: 2500,
  /** How long the "pull back further" hint stays, ms. */
  furtherHintMs: 1500,

  // Fallback for trackers that never see the fist
  fistFallbackMs: 6000,
  fallbackReleaseSpeed: 2.5,
  fallbackHoldMs: 2500,
  /** Draw must stay within this of its anchor to count as held. */
  fallbackHoldBand: 0.05,
  /** Draw above this counts as full draw for the fallback release. */
  fallbackFullDraw: 0.85,

  // Arrow flight
  minArrowSpeed: 28,
  maxArrowSpeed: 62,
  gravity: 9.81,
  /** Largest crosswind acceleration, m/s^2. */
  maxWind: 1.2,
  /** Where the arrow leaves the bow (the archer stands at the origin facing -z), m. */
  originX: 0,
  originY: 1.5,
  originZ: -0.3,

  // Target
  targetRadius: 0.61,
  targetHeight: 1.3,
  targetDistance: 30,
  /** An arrow this close outside a ring scores the higher ring, m. */
  lineTolerance: 0.003,

  // View
  /** Camera behind the archer: metres back, up, and out to the bow side. */
  camBack: 2.8,
  camHeight: 1.8,
  camSide: 1.0,
  /** 0 looks straight at the target, 1 at the archer's chest. */
  camLookArcher: 0.2,
  /** The camera pitches down this much from the line to the target (radians) to show the archer. */
  camPitchDown: 0.05,
  fovBase: 30,
  fovDraw: 21,
  fovShow: 34,
  /** Reticle radius at no draw and at full draw, m on the target plane. */
  reticleMaxM: 1.6,
  reticleMinM: 0.45,
};

export type ArcheryConfig = typeof archeryConfig;

export const archeryRanges: Record<string, TunableRange> = {
  arrows: { min: 1, max: 12, step: 1 },
  shortArrows: { min: 1, max: 6, step: 1 },
  showHitMs: { min: 300, max: 4000, step: 100 },
  bowMinReach: { min: 0.3, max: 1.4, step: 0.05 },
  bowMaxDrop: { min: 0.3, max: 1.6, step: 0.05 },
  neutralX: { min: 0.5, max: 1.6, step: 0.05 },
  aimGainX: { min: 0.05, max: 0.6, step: 0.01 },
  aimGainY: { min: 0.05, max: 0.6, step: 0.01 },
  aimSmoothS: { min: 0.02, max: 0.5, step: 0.01 },
  maxSwayRad: { min: 0, max: 0.05, step: 0.001 },
  swayRampS: { min: 0.5, max: 12, step: 0.5 },
  nockDistance: { min: 0.3, max: 2, step: 0.05 },
  drawStart: { min: 0.2, max: 1.5, step: 0.05 },
  drawFull: { min: 1, max: 3.2, step: 0.05 },
  minDraw: { min: 0.05, max: 0.8, step: 0.05 },
  releaseLookbackMs: { min: 0, max: 400, step: 10 },
  fistFallbackMs: { min: 1000, max: 20000, step: 500 },
  maxWind: { min: 0, max: 4, step: 0.1 },
  targetRadius: { min: 0.2, max: 1.5, step: 0.01 },
  targetDistance: { min: 10, max: 70, step: 1 },
  fovBase: { min: 10, max: 50, step: 1 },
  fovDraw: { min: 8, max: 40, step: 1 },
  camBack: { min: 1, max: 8, step: 0.1 },
  camHeight: { min: 1, max: 4, step: 0.1 },
  camSide: { min: -3, max: 3, step: 0.1 },
  camLookArcher: { min: 0, max: 1, step: 0.05 },
  camPitchDown: { min: 0, max: 0.3, step: 0.01 },
};
