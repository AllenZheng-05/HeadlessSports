/**
 * Every recognizer threshold, in one typed, mutable object (editable live from the tunables
 * panel). Units: sw = shoulder widths; speeds sw/s; angles rad; times ms of frame time.
 */
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
  cadence: {
    /** Knee lift (sw) that starts a step. */
    minLift: number;
    minStepMs: number;
    /** Intervals longer than this do not enter the cadence average. */
    maxStepMs: number;
    /** No step for this long: cadence has decayed to 0. */
    decayMs: number;
    /** Number of step intervals averaged. */
    smoothing: number;
    /** Steps per second ceiling. */
    softCap: number;
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
    minLift: 0.22,
    minStepMs: 140,
    maxStepMs: 900,
    decayMs: 800,
    smoothing: 4,
    softCap: 5,
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
