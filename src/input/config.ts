import type { FistConfig } from './hands/fist';
import { sideGuardConfig } from './sideGuard';
import type { SideGuardConfig } from './sideGuard';

/**
 * One typed, mutable config object for the whole input layer. Filter values are starting points
 * assuming normalised image coordinates (speeds of order 1 unit/s); they are tuned by playtest.
 */
export interface InputConfig {
  filter: {
    /** Responsive: wrists and hand points. */
    wrist: { minCutoff: number; beta: number };
    /** Elbows, shoulders. */
    arm: { minCutoff: number; beta: number };
    /** Hips, torso, legs, face. */
    body: { minCutoff: number; beta: number };
    /** Palm centre. */
    hand: { minCutoff: number; beta: number };
  };
  fist: FistConfig;
  /** Left/right consistency guard on the pose landmarks. */
  sideGuard: SideGuardConfig;
  /** Samples in the least-squares velocity window. */
  velocityWindow: number;
  minVisibility: number;
  /**
   * The less visible shoulder only has to reach this for the body to count as tracked (the nearer
   * one needs `minVisibility`): side-on, the far shoulder hides behind the torso.
   */
  farShoulderVisibility: number;
  lostAfterMs: number;
}

export const inputConfig: InputConfig = {
  filter: {
    wrist: { minCutoff: 1.5, beta: 8 },
    arm: { minCutoff: 1.2, beta: 4 },
    body: { minCutoff: 1.0, beta: 1 },
    hand: { minCutoff: 1.5, beta: 6 },
  },
  fist: { closeBelow: 0.9, openAbove: 1.3, holdFrames: 2 },
  sideGuard: { ...sideGuardConfig },
  velocityWindow: 4,
  minVisibility: 0.5,
  farShoulderVisibility: 0.2,
  lostAfterMs: 400,
};
