import type { TunableRange } from '../../core/sport';

/** The home-run distance, in feet. */
export const HOMER_FEET = 350;
/** Metres in the fence the model was first tuned with (246 ft). */
const OLD_FENCE_M = 75;
/**
 * Scale from the original distance model to the 350 ft one. Lengths scale by S, speeds and times by
 * sqrt(S) and drag by 1/S (the same projectile path stretched), so every swing goes S times as far
 * and clears or misses the fence by the same proportion as before.
 */
export const DISTANCE_SCALE = (HOMER_FEET * 0.3048) / OLD_FENCE_M;
const SPEED_SCALE = Math.sqrt(DISTANCE_SCALE);

/**
 * Every number of the batting sport, in one mutable object registered with the tunables panel.
 * Times are game ms, lengths metres, angles degrees, speeds m/s unless a name says otherwise.
 * The score is whole feet (see units.ts); `homerBonus` is in feet too.
 */
export const battingConfig = {
  // ---- round ----
  pitches: 10,
  /** Pitches in a ?short=1 round. */
  shortPitches: 3,
  // Pitch rhythm. After a result: the outcome beat, then the reset (batter settles, "Get ready"),
  // then the pitcher comes set and holds, then the wind-up and the release. About 3.8 s from a
  // result to the next release (a long fly stretches the beat), a little longer before the first.
  /** From the start of the round to the pitcher coming set for the first pitch ("Get ready" shows). */
  firstPitchDelayMs: 3000,
  /** The result stays on screen this long before the reset begins. */
  resultBeatMs: 1400,
  /** Longest result beat after a long fly (the player gets to watch it land). */
  maxResultBeatMs: 3000,
  /**
   * Flights last sqrt(distance scale) longer than they did at 246 ft; the beat only waits for the
   * flight as it was then, so the gap between pitches does not grow (maxResultBeatMs caps it anyway).
   */
  airBeatScale: 1 / SPEED_SCALE,
  /** The batter settles into the stance and the "Get ready" cue shows. */
  resetMs: 900,
  /** The pitcher stands set, hands together, before the wind-up. */
  setMs: 600,
  /** The set is held a seeded random +- this much longer or shorter, so it is not metronomic. */
  setJitterMs: 250,
  /** ?short=1 rounds multiply the first delay, result beat, reset and set by this. */
  shortGapScale: 0.4,
  /** Pause after the last pitch resolves, before the celebrate or slump clip. */
  endPauseMs: 1200,
  /** The clip plays this long before ctx.finish is called. */
  finishDelayMs: 1200,
  /** Real-time sources only: a gap between two updates longer than this is a pause; the pitch timeline shifts. */
  pauseGapMs: 250,

  // ---- pitching ----
  /** From the end of the set to the release. */
  windupMs: 900,
  /** Ball flight time, release to plate. */
  flightEasyMs: 900,
  flightMediumMs: 720,
  flightHardMs: 600,
  /** Pitches 1..easyUntil are easy, then medium up to mediumUntil, then hard. */
  easyUntil: 4,
  mediumUntil: 8,
  /** Where the pitch crosses the front of the plate (z, metres; the batter stands at z 0, facing -z). */
  plateZ: -0.65,
  /** The pitcher is drawn this much larger than the batter. */
  pitcherScale: 1.25,
  /** Pitcher's mound distance from the plate. */
  moundDistance: 14,
  /** Release point used when the pitcher's hand position is not sampled (tests). */
  releaseX: -0.22,
  releaseY: 1.5,
  releaseZ: -13.5,
  /** Height of the three pitch bands over the plate. */
  heightLow: 0.55,
  heightMiddle: 0.85,
  heightHigh: 1.15,
  /** Lateral wobble over the plate, +-metres. Does not affect hitting. */
  lateralWobble: 0.12,
  gravity: 9.81,
  /** Ball size (exaggerated so it reads at 14 m). */
  ballRadius: 0.13,

  // ---- judging ----
  /** The bat reaches the hitting zone this long after the swing starts. */
  batTravelMs: 130,
  perfectMs: 45,
  goodMs: 95,
  okMs: 160,
  foulMs: 230,
  /** A swing starting later than arrival plus this still counts for the pitch (as "Too late"). */
  lateWindowMs: 250,
  /** Swing events are reported late: a pitch with no swing resolves this long after the window closes. */
  eventDelayAllowanceMs: 250,
  /** A "why nothing happened" hint (swing too slow, too late, arm lost) stays up this long, ms. */
  noticeMs: 2000,
  /** A SwingPeak counts for the power only when it arrives within this of the start event. */
  peakWaitMs: 200,
  /** Hand height (sw above the shoulder line) to bat height (m). */
  shoulderHeightM: 1.3,
  swToMetres: 0.4,
  batDrop: 0.35,
  batHeightMin: 0.35,
  batHeightMax: 1.45,
  /** Bat further than this from the ball centre height is a miss. */
  missHeight: 0.38,
  baseLaunch: 14,
  launchPerMetre: 75,
  launchMin: -12,
  launchMax: 55,
  /** SwingStarted.speed is a ramp-up speed: scaled before it is used as the peak speed. */
  startSpeedGain: 1.5,
  powerFloor: 3,
  powerCeil: 9,
  minExit: 18 * SPEED_SCALE,
  maxExit: 46 * SPEED_SCALE,
  qualityPerfect: 1,
  qualityGood: 0.82,
  qualityWeak: 0.5,
  /** Degrees of spray per ms of timing error (early pulls, late pushes). */
  sprayPerMs: 0.22,
  sprayMax: 40,
  /** Degrees off the line for a foul ball. */
  foulSprayDeg: 70,

  // ---- flight ----
  /** Quadratic drag, 1/m. */
  drag: 0.0046 / DISTANCE_SCALE,
  /** Launch angles below this roll along the ground. */
  groundMaxDeg: 5,
  /** Time constant of the ground roll, seconds. */
  rollTau: 0.85 * SPEED_SCALE,
  /** Roll after landing for a fly ball: factor times cos(launch)^2 times the carry. */
  rollFactor: 0.14,
  hitStartHeight: 1,
  /** 350 ft. */
  fenceDistance: HOMER_FEET * 0.3048,
  fenceHeight: 1.2,
  /**
   * The path is simulated this much taller than it is drawn (start height and wall top included),
   * so it is an exact scaled copy of the old one; heights are divided by it on the way out.
   */
  heightScale: DISTANCE_SCALE,
  /** A home run rolls on after landing by at most this much (m). */
  homerRollMax: 6 * DISTANCE_SCALE,
  /** Score bonus for a home run, in feet (the old 66 ft bonus scaled with the distances). */
  homerBonus: Math.round(66 * DISTANCE_SCALE),

  // ---- camera ----
  /**
   * The batter stands side-on in the box beside the plate: a right-handed batter on the screen-left
   * side (the camera is behind the batter), a left-handed batter on the screen-right side. Distance
   * from the plate's centre line to the batter's chest, so the bat's sweet spot reaches the plate.
   */
  batterOffset: 0.9,
  cameraBack: 3.0,
  cameraHeight: 1.75,
  /** The camera sits this far toward the plate side of the batter (opposite to the batter). */
  cameraSide: 0.3,
  /** Hit balls that travel further than this are tracked by the camera. */
  cameraFollowFrom: 30 * DISTANCE_SCALE,
  /** The camera follow reaches full weight at this distance from the plate (m). */
  cameraFollowFull: 40 * DISTANCE_SCALE,
  cameraFollowWeight: 0.8,

  // ---- batter's stance and swing (visual only) ----
  /** The swing pose starts this long before contact and the bat is back in the stance this long after. */
  swingLeadMs: 230,
  swingFollowMs: 600,
  swingReturnMs: 300,
  /** How fast the hands and bat follow the keyed pose (1/s). */
  poseRate: 28,
  /** Stance waggle of the bat while the pitcher is set, radians-ish. */
  waggle: 0.07,
  /** Time to turn to face the camera for the end-of-round clip (1/s). */
  turnRate: 7,

  // ---- bot ----
  /** Measured: SwingStarted.t minus the start of the twoHandSwing steps (ms). */
  botOnsetOffsetMs: 1360,
  /** The bot's stance step is stretched to this (see botSwingSteps). */
  botStanceMs: 850,
  /** Measured: SwingStarted.height minus the `height` option of twoHandSwing (sw). */
  botHeightOffset: 0.16,
  botJitterMs: 40,
  /** Desired bat height below the ball centre (m); a slightly low bat lifts the ball. */
  botBatBelowBall: 0.1,
  botPower: 0.8,

  // ---- tutorial (no timer, no limits; pitches keep coming at a relaxed rhythm) ----
  /** From the start of the pitching steps to the first pitch coming set. */
  tutorialFirstPitchMs: 1500,
  /** Extra time between a result and the next pitch, on top of the normal rhythm. */
  tutorialGapMs: 500,
  /** Flight time of the slow practice pitches (release to plate). */
  tutorialSlowFlightMs: 1800,
  /** Flight time of the "full speed" pitches in the last step. */
  tutorialFullFlightMs: 800,
  /** The last step ends after a hit, or after this many pitches. */
  tutorialFullPitches: 3,
  /** The "a little faster" swing needs at least this power (0..1). */
  tutorialMinPower: 0.4,
  /** Hands count as together when the wrists are closer than this (sw)... */
  tutorialStanceGapSw: 0.7,
  /** ...at a height between these (sw above the shoulder line)... */
  tutorialStanceMinY: -1.3,
  tutorialStanceMaxY: 0.9,
  /** ...and with the faster wrist slower than this (sw/s); the swing's readySpeed is 2. */
  tutorialStanceMaxSpeed: 2,
  /**
   * In the practice steps (no pitch yet) a rejected motion is only explained when its peak speed
   * reaches this (sw/s), so ordinary arm movement says nothing. Between swing.readySpeed and
   * swing.minPeak.
   */
  tutorialNoticeMinSpeed: 3,
  /** Hands together and still for this long counts as the stance. */
  tutorialStanceMs: 700,
  /** Seen and tracked for this long counts as step 1. */
  tutorialTrackedMs: 600,
  /** Instruction feedback (what to do differently) shows after this long on a step. */
  tutorialHintDelayMs: 3500,
};

export type BattingConfig = typeof battingConfig;

/** Slider ranges for the tunables panel. */
export const battingRanges: Record<string, TunableRange> = {
  batTravelMs: { min: 0, max: 300, step: 5 },
  perfectMs: { min: 10, max: 150, step: 5 },
  noticeMs: { min: 500, max: 5000, step: 100 },
  goodMs: { min: 20, max: 250, step: 5 },
  okMs: { min: 40, max: 350, step: 5 },
  foulMs: { min: 60, max: 450, step: 5 },
  lateWindowMs: { min: 0, max: 500, step: 10 },
  windupMs: { min: 300, max: 2000, step: 50 },
  firstPitchDelayMs: { min: 500, max: 6000, step: 100 },
  resultBeatMs: { min: 400, max: 4000, step: 100 },
  maxResultBeatMs: { min: 800, max: 6000, step: 100 },
  resetMs: { min: 0, max: 3000, step: 100 },
  setMs: { min: 200, max: 2000, step: 50 },
  setJitterMs: { min: 0, max: 600, step: 25 },
  batterOffset: { min: 0.5, max: 1.3, step: 0.05 },
  flightEasyMs: { min: 400, max: 1500, step: 20 },
  flightMediumMs: { min: 400, max: 1500, step: 20 },
  flightHardMs: { min: 400, max: 1500, step: 20 },
  missHeight: { min: 0.1, max: 0.8, step: 0.02 },
  baseLaunch: { min: 0, max: 40, step: 1 },
  launchPerMetre: { min: 20, max: 150, step: 5 },
  sprayPerMs: { min: 0, max: 0.5, step: 0.01 },
  drag: { min: 0, max: 0.01, step: 0.0001 },
  homerBonus: { min: 0, max: 470, step: 5 },
  homerRollMax: { min: 0, max: 20, step: 0.5 },
  botOnsetOffsetMs: { min: 0, max: 2000, step: 10 },
  botJitterMs: { min: 0, max: 150, step: 5 },
  tutorialFirstPitchMs: { min: 500, max: 5000, step: 100 },
  tutorialGapMs: { min: 0, max: 4000, step: 100 },
  tutorialSlowFlightMs: { min: 900, max: 3500, step: 100 },
  tutorialFullFlightMs: { min: 400, max: 1500, step: 20 },
  tutorialFullPitches: { min: 1, max: 10, step: 1 },
  tutorialMinPower: { min: 0, max: 1, step: 0.05 },
  tutorialStanceGapSw: { min: 0.2, max: 1.4, step: 0.05 },
  tutorialStanceMinY: { min: -3, max: 0, step: 0.1 },
  tutorialStanceMaxY: { min: 0, max: 2, step: 0.1 },
  tutorialStanceMaxSpeed: { min: 0.5, max: 4, step: 0.1 },
  tutorialNoticeMinSpeed: { min: 2, max: 4, step: 0.1 },
  tutorialStanceMs: { min: 200, max: 3000, step: 100 },
  tutorialTrackedMs: { min: 200, max: 3000, step: 100 },
  tutorialHintDelayMs: { min: 1000, max: 10000, step: 250 },
};
