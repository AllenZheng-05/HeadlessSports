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
  bowMinReach: 0.4,
  /** ... and no further than this above or below shoulder height, sw. */
  bowMaxDrop: 1.2,
  /** Same two limits once the arrow is nocked (looser, so a sagging arm does not drop it), sw. */
  bowHoldMinReach: 0.25,
  bowHoldMaxDrop: 1.35,
  /**
   * Side-on stance: the bow arm points at the camera, so its wrist sits close to the shoulder in 2D.
   * Also counts as up when the wrist is at least this far (sw) from the shoulder and no lower than
   * `bowRaisedY` (sw, positive up) relative to it.
   */
  bowRaisedReach: 0.15,
  bowRaisedY: -0.2,
  /** Lowering the bow arm this long while drawing puts the arrow back, ms. */
  bowDropMs: 900,

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
  nockDistance: 1.9,
  /** Once the hands have been that close, they stay "together" until this far apart, sw. */
  nockKeepDistance: 2.3,
  /** A fist that closed this recently still nocks when the hands arrive, ms. */
  nockGraceMs: 1200,
  /** No-fist nock: hands that were within this of each other (sw) ... */
  nockPullNear: 1.4,
  /** ... and then pull apart by this much (sw) at this speed (sw/s) nock without a fist. */
  nockPullDelta: 0.45,
  nockPullSpeed: 0.6,
  /** ... within this long of being near, ms. */
  nockPullWindowMs: 1500,
  /** The bow arm must have been up this long first, so raising it does not count as a pull, ms. */
  nockPullBowStableMs: 400,
  /**
   * Wrist distance (sw) that is 0% draw at the floor, and 100% draw. The pull from 0% to 100% is
   * `drawFull - drawStart`; 0% itself follows the closest the hands came since the nock.
   */
  drawStart: 0.5,
  drawFull: 1.65,
  drawSmoothS: 0.08,
  /** Below this draw the arrow is put back instead of shot. */
  minDraw: 0.2,
  /** The shot uses draw and aim from this long before the open event, ms. */
  releaseLookbackMs: 120,
  /** The draw hand model is not seen (pose still fine) this long while drawing puts the arrow back, ms. */
  lostHandCancelMs: 3500,

  // Tracking loss: never shoot because something was lost
  /** A wrist lost (out of frame, occluded, low confidence): the draw and aim hold for this long, ms. */
  lostGraceMs: 700,
  /** Past the grace the bow eases down over this long and the arrow goes back, ms. */
  letDownMs: 600,
  /** Smoothing time of that let-down, s. */
  letDownS: 0.3,
  /** After tracking returns or the wrists jump, no release is accepted for this long, ms. */
  reacquireMs: 250,
  /** A wrist distance change bigger than this between two steps is a glitch, not a move, sw. */
  jumpSw: 0.9,
  /** Wrists below this pose visibility count as lost. */
  minWristVisibility: 0.25,
  /** An open hand must stay open and tracked this long before it releases, ms. */
  releaseConfirmMs: 40,
  /** Kinematic release: the wrists close in faster than this (sw/s) for this long ... */
  collapseSpeed: 5,
  collapseConfirmMs: 60,
  /** ... from at least this much draw. */
  collapseMinDraw: 0.5,
  /** ... and only if both wrists read at least this visible throughout the collapse window. */
  collapseMinVisibility: 0.6,
  /** A collapse faster than this (sw/s) is a tracking glitch, not a human release. */
  collapseMaxSpeed: 14,
  /** Look-back for "had this much draw lately" in the kinematic release, ms. */
  collapseRecentMs: 250,
  /**
   * A hand that was closed before a tracking gap and comes back reading open, with wrists tracked,
   * must stay open this long before it releases (less trusted than a live open edge), ms.
   */
  reopenConfirmMs: 200,
  /** How long the "pull back further" hint stays, ms. */
  furtherHintMs: 1500,

  // Camera-off (mouse) draw
  /** Seconds holding the button from the nock to full draw. */
  mouseDrawS: 0.75,

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

  // Tutorial (optional, never scored, arrows unlimited until the steps are done)
  /** Arrows the tutorial round holds: far more than the steps ask for, so it never runs out. */
  tutorialArrows: 99,
  /** Arrows that must land after the "shoot more" step begins. */
  tutorialMoreShots: 2,
  /** Crosswind and hand sway scale in the tutorial: 0 is calm. */
  tutorialWindScale: 0,
  tutorialSwayScale: 0,
  /** The feedback line waits this long after a step appears, ms. */
  tutorialHintDelayMs: 2500,
  /** Shoulders and both hands in view this long, ms. */
  tutorialTrackedMs: 600,
  /** Bow arm up this long, ms. */
  tutorialBowMs: 500,
  /** Draw that counts as a full pull. */
  tutorialDrawFull: 0.9,
  /** Aim counts when the full-draw landing point is this close to the centre (m) for this long (ms). */
  tutorialAimRadiusM: 1,
  tutorialAimHoldMs: 700,
  /** "I lost your hand" shows once the hand has been out this long, ms. */
  tutorialLostMs: 400,
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
  bowHoldMinReach: { min: 0.2, max: 1.4, step: 0.05 },
  bowHoldMaxDrop: { min: 0.3, max: 1.8, step: 0.05 },
  bowDropMs: { min: 200, max: 3000, step: 100 },
  nockDistance: { min: 0.3, max: 3, step: 0.05 },
  nockKeepDistance: { min: 0.3, max: 3.5, step: 0.05 },
  nockGraceMs: { min: 100, max: 3000, step: 100 },
  nockPullNear: { min: 0.3, max: 2.5, step: 0.05 },
  nockPullDelta: { min: 0.1, max: 1.5, step: 0.05 },
  nockPullSpeed: { min: 0.1, max: 3, step: 0.1 },
  nockPullWindowMs: { min: 200, max: 4000, step: 100 },
  nockPullBowStableMs: { min: 0, max: 2000, step: 50 },
  lostHandCancelMs: { min: 500, max: 8000, step: 250 },
  bowRaisedReach: { min: 0, max: 0.6, step: 0.05 },
  bowRaisedY: { min: -1, max: 0.5, step: 0.05 },
  lostGraceMs: { min: 200, max: 2500, step: 50 },
  letDownMs: { min: 100, max: 2000, step: 50 },
  letDownS: { min: 0.05, max: 1, step: 0.05 },
  reacquireMs: { min: 0, max: 800, step: 25 },
  jumpSw: { min: 0.3, max: 2, step: 0.05 },
  minWristVisibility: { min: 0.05, max: 0.8, step: 0.05 },
  releaseConfirmMs: { min: 0, max: 200, step: 10 },
  collapseSpeed: { min: 2, max: 12, step: 0.5 },
  collapseConfirmMs: { min: 10, max: 200, step: 10 },
  collapseMinDraw: { min: 0.2, max: 0.95, step: 0.05 },
  collapseMinVisibility: { min: 0.25, max: 0.95, step: 0.05 },
  collapseMaxSpeed: { min: 6, max: 40, step: 1 },
  collapseRecentMs: { min: 50, max: 600, step: 10 },
  reopenConfirmMs: { min: 40, max: 600, step: 20 },
  drawStart: { min: 0.2, max: 1.5, step: 0.05 },
  drawFull: { min: 1, max: 3.2, step: 0.05 },
  minDraw: { min: 0.05, max: 0.8, step: 0.05 },
  mouseDrawS: { min: 0.2, max: 2, step: 0.05 },
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
  tutorialMoreShots: { min: 1, max: 10, step: 1 },
  tutorialWindScale: { min: 0, max: 1, step: 0.05 },
  tutorialSwayScale: { min: 0, max: 1, step: 0.05 },
  tutorialHintDelayMs: { min: 500, max: 8000, step: 100 },
  tutorialTrackedMs: { min: 100, max: 3000, step: 50 },
  tutorialBowMs: { min: 100, max: 3000, step: 50 },
  tutorialDrawFull: { min: 0.3, max: 1, step: 0.05 },
  tutorialAimRadiusM: { min: 0.2, max: 2, step: 0.05 },
  tutorialAimHoldMs: { min: 100, max: 3000, step: 50 },
  tutorialLostMs: { min: 100, max: 2000, step: 50 },
};
