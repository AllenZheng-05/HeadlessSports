/**
 * Every recognizer threshold, in one typed, mutable object (editable live from the tunables
 * panel). Units: sw = shoulder widths; speeds sw/s; angles rad; times ms of frame time.
 */
export interface CadenceCueConfig {
  /** Retrace (sw) that confirms a peak. Keep it a few noise sigmas above the filtered jitter. */
  threshold: number;
  /** Smallest peak-to-peak swing (sw) that counts as a step. */
  minSwing: number;
  /** A typical running swing (sw): the effort scale for the reported amplitude. */
  nominalSwing: number;
  /** How much this cue's confidence counts in the fusion (0..1). */
  weight: number;
}

export interface RecognizerConfig {
  /**
   * Velocity estimates come from a least-squares slope over the last few samples, so they describe
   * the motion about this many frames ago. Peak and start times are moved back by this much.
   */
  velocityLagFrames: number;
  armRaise: {
    /** Wrist above the shoulder by this much (sw) for `dwellMs` counts as raised. */
    raiseAbove: number;
    lowerBelow: number;
    dwellMs: number;
  };
  /**
   * Running in place, fused from several front-view cues (arm pump, thigh foreshortening, foot
   * lift, torso bob). Each cue is a signal in sw that is high-passed, low-passed and run through a
   * zigzag peak detector; a peak is one step. See `CadenceRecognizer`.
   */
  cadence: {
    /** Steps closer together than this are one step (ms); about 6 steps per second. */
    minStepMs: number;
    /** Steps further apart than this restart a cue (ms); about 1.3 steps per second. */
    maxStepMs: number;
    /** No accepted step from any cue for this long: not running (ms). */
    decayMs: number;
    /** Time constant of the smoothing of the reported step rate (ms). */
    rateSmoothMs: number;
    /** Steps per second ceiling. */
    softCap: number;
    /** High-pass time constant: slower drift (posture, weight shift) is removed (ms). */
    highpassMs: number;
    /** Low-pass time constant: landmark noise is removed (ms). */
    lowpassMs: number;
    /** A cue is stale when no step has come for staleFactor * interval + staleSlackMs. */
    staleFactor: number;
    staleSlackMs: number;
    /** Consecutive step intervals may differ by at most this ratio before a cue starts over. */
    maxIntervalRatio: number;
    /** Interval spread (mean absolute deviation over median) at which a cue's regularity is 0. */
    maxSpread: number;
    /** Cue confidence for a streak of two and of three steps (four or more is 1). */
    peakConf2: number;
    peakConf3: number;
    /** Cues whose rates differ by less than this fraction agree. */
    agreement: number;
    /** Summed confidence of the agreeing cues needed to start and to keep running. */
    runThreshold: number;
    stopThreshold: number;
    /** Reported amplitude at full effort, sw: the scale the javelin run speed was tuned on. */
    amplitudeScale: number;
    /** A wrist faster than this (sw/s) is a throw or a punch, not a pump: the arm cue starts over. */
    armBlankSpeed: number;
    /** The arm cue stays off this long after such a movement (ms). */
    armBlankMs: number;
    /** Ankles are only used when this visible. */
    footMinVisibility: number;
    /** Arm cue: wrist and elbow height relative to the shoulders, left minus right, halved. */
    arm: CadenceCueConfig & { elbowWeight: number };
    /** Thigh cue: knee drop below the hip and hip-knee projected length, left minus right. */
    thigh: CadenceCueConfig & { lengthWeight: number };
    /** Foot cue: ankle height relative to the hip, left minus right. Weak when ankles are noisy. */
    foot: CadenceCueConfig;
    /** Torso bob: shoulder and hip midpoint height, one rise per step. */
    bob: CadenceCueConfig;
  };
  throw: {
    /** Wrist speed below which the arm is 'ready'. */
    armSpeed: number;
    armMs: number;
    startSpeed: number;
    minPeak: number;
    /** Release confirmed when speed < peak * dropRatio. */
    dropRatio: number;
    minAccelMs: number;
    maxAccelMs: number;
    cooldownMs: number;
    curvatureWindowMs: number;
    /** Distance (sw) the wrist must travel away from where it rested to count as a wind-up. */
    windupBack: number;
    /** While the shoulders move faster than this (sw/s) wind-up tracking is suspended: the wrist
     * and shoulder filters lag differently, so a fast sidestep looks like an arm movement. */
    maxBodySpeed: number;
  };
  swing: {
    /** Both wrists closer than this (sw) is a two-handed grip. */
    gripDistance: number;
    readySpeed: number;
    startSpeed: number;
    minPeak: number;
    dropRatio: number;
    cooldownMs: number;
    /** Once a swing has started, a lost grip (blurred wrist) is tolerated this long (ms). */
    gripGraceMs: number;
  };
  punch: {
    minPeak: number;
    /** Elbow extension rate (rad/s) needed at some point during the acceleration. */
    minElbowRate: number;
    cooldownMs: number;
    maxWristY: number;
    minWristY: number;
  };
  squat: { depth: number; dwellMs: number };
  jump: { height: number; cooldownMs: number };
}

export const recognizerConfig: RecognizerConfig = {
  velocityLagFrames: 2,
  armRaise: { raiseAbove: 0.75, lowerBelow: 0.35, dwellMs: 180 },
  cadence: {
    minStepMs: 160,
    maxStepMs: 750,
    decayMs: 800,
    rateSmoothMs: 250,
    softCap: 5,
    highpassMs: 600,
    lowpassMs: 35,
    staleFactor: 1.35,
    staleSlackMs: 40,
    maxIntervalRatio: 1.7,
    maxSpread: 0.45,
    peakConf2: 0.5,
    peakConf3: 0.9,
    agreement: 0.25,
    runThreshold: 0.7,
    stopThreshold: 0.35,
    amplitudeScale: 0.45,
    armBlankSpeed: 9,
    armBlankMs: 400,
    footMinVisibility: 0.7,
    arm: { threshold: 0.08, minSwing: 0.2, nominalSwing: 0.5, weight: 1, elbowWeight: 0.5 },
    thigh: { threshold: 0.045, minSwing: 0.1, nominalSwing: 0.25, weight: 1, lengthWeight: 0.5 },
    foot: { threshold: 0.06, minSwing: 0.13, nominalSwing: 0.3, weight: 0.85 },
    bob: { threshold: 0.02, minSwing: 0.045, nominalSwing: 0.1, weight: 0.85 },
  },
  throw: {
    armSpeed: 1.5,
    armMs: 80,
    startSpeed: 2.0,
    minPeak: 2.5,
    dropRatio: 0.85,
    minAccelMs: 50,
    maxAccelMs: 300,
    cooldownMs: 450,
    curvatureWindowMs: 150,
    windupBack: 0.25,
    maxBodySpeed: 3,
  },
  swing: {
    gripDistance: 0.7,
    readySpeed: 1.5,
    startSpeed: 3.0,
    minPeak: 4.5,
    dropRatio: 0.85,
    cooldownMs: 500,
    gripGraceMs: 120,
  },
  punch: { minPeak: 4.0, minElbowRate: 4, cooldownMs: 350, maxWristY: 0.7, minWristY: -0.6 },
  squat: { depth: 0.35, dwellMs: 150 },
  jump: { height: 0.22, cooldownMs: 400 },
};
