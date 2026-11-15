import type { TunableRange } from '../../core/sport';

/** Every number of the climbing sport. One mutable object, registered with the tunables panel. */
export const climbingConfig = {
  // Hands to wall: wall offset from the shoulder centre, metres.
  reachWidth: 1.7,
  reachHeight: 1.5,
  reachOffsetY: 0.25,
  /** A hold is let go when it ends up this much farther than the reach box. */
  reachSlack: 1.15,

  // Grabbing.
  jugRadius: 0.17,
  crimpRadius: 0.1,
  /** A fresh fist may still grab for this long after it closed (the fist is debounced). */
  grabWindowMs: 250,
  lostHandGraceMs: 500,
  slipGraceMs: 350,

  // Climber motion.
  maxClimbSpeed: 3.0,
  /** Follow rate toward the solved position, 1/s. Higher is stiffer. */
  followRate: 22,
  /** The climber's shoulder centre stays within this lateral range, metres. */
  wallHalfWidth: 1.0,
  gravity: 9.8,

  // Stamina, per second.
  drainTwoHands: 0.02,
  drainOneHand: 0.035,
  crimpDrainMult: 1.6,
  ledgeRefillPerSecond: 0.35,
  restRefillPerSecond: 0.01,
  /** Hands cannot grab below this stamina. */
  minGrabStamina: 0.02,
  staminaWarn: 0.35,
  staminaBad: 0.15,

  // Round.
  roundSeconds: 75,
  shortRoundSeconds: 25,
  finishDelayS: 1.2,
  milestoneEveryM: 10,

  // Layout.
  rowStepM: 0.29,
  rowJitterM: 0.06,
  lateralRange: 0.85,
  centreGapM: 0.12,
  minSpacingM: 0.22,
  extraHoldChance: 0.35,
  crimpStartM: 8,
  crimpBase: 0.08,
  crimpPerMetre: 0.03,
  crimpMax: 0.45,
  ledgeEveryM: 20,
  /** Feet within [-below, +above] of a ledge top count as standing on it. */
  ledgeStandBelowM: 0.15,
  ledgeStandAboveM: 0.3,

  // World and avatar.
  avatarScale: 1.7,
  wallZ: -0.45,
  climberZ: -0.05,
  /** Local-space z of a mitt on a hold, and of a free hovering mitt. */
  mittHoldZ: -0.1,
  mittHoverZ: -0.02,
  wallWidth: 3.8,

  // Camera.
  cameraBelowM: 3.1,
  cameraAboveM: 1.9,
  cameraSmoothS: 0.25,
  cameraFov: 45,
};

export type ClimbingConfig = typeof climbingConfig;

export const climbingRanges: Record<string, TunableRange> = {
  reachWidth: { min: 0.8, max: 3, step: 0.05 },
  reachHeight: { min: 0.8, max: 3, step: 0.05 },
  reachOffsetY: { min: -0.5, max: 0.8, step: 0.05 },
  reachSlack: { min: 1, max: 2, step: 0.05 },
  jugRadius: { min: 0.05, max: 0.4, step: 0.01 },
  crimpRadius: { min: 0.03, max: 0.3, step: 0.01 },
  grabWindowMs: { min: 0, max: 800, step: 10 },
  lostHandGraceMs: { min: 0, max: 2000, step: 50 },
  slipGraceMs: { min: 0, max: 2000, step: 50 },
  maxClimbSpeed: { min: 0.5, max: 8, step: 0.1 },
  followRate: { min: 2, max: 60, step: 1 },
  drainTwoHands: { min: 0, max: 0.3, step: 0.005 },
  drainOneHand: { min: 0, max: 0.3, step: 0.005 },
  crimpDrainMult: { min: 1, max: 4, step: 0.1 },
  ledgeRefillPerSecond: { min: 0, max: 2, step: 0.05 },
  restRefillPerSecond: { min: 0, max: 0.2, step: 0.005 },
  roundSeconds: { min: 10, max: 300, step: 5 },
  shortRoundSeconds: { min: 5, max: 120, step: 1 },
  avatarScale: { min: 1, max: 2.5, step: 0.05 },
  cameraBelowM: { min: 1, max: 5, step: 0.1 },
  cameraAboveM: { min: 1, max: 5, step: 0.1 },
  cameraSmoothS: { min: 0.05, max: 1, step: 0.05 },
};
