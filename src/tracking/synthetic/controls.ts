/**
 * The synthetic player's pose parameters. Everything is a number so that scripts can interpolate
 * any of them. See `body.ts` for how they become landmarks.
 */

/** Everything that defines the synthetic player's pose at one instant. All numeric so it interpolates. */
export interface BodyControls {
  // Whole body
  /** 1 body in frame, 0 no body (hasPose false). */
  bodyVisible: number;
  /** Shoulder-midpoint x, mirrored normalised (0.5 = centre). */
  centreX: number;
  /** Shoulder-midpoint y, normalised (about 0.32 at full-body distance). */
  shoulderY: number;
  /** 2D shoulder width as a fraction of image HEIGHT (about 0.13 at 2.2 m; 0 in hands-only mode). */
  shoulderWidth: number;
  /** Radians, positive leans toward screen right. */
  lean: number;
  /** 0 standing .. 1 deep squat (hips and shoulders drop, knees bend). */
  crouch: number;
  /** Whole-body rise in sw (shoulder widths), 0 on the ground. */
  jump: number;
  // Arms: wrist target relative to the same-side shoulder, in sw. x positive toward screen right,
  // y positive UP. The elbow is placed by a 2D two-bone solve (upper arm 0.80 sw, forearm 0.72 sw),
  // bending outward and down. Targets beyond the reach are clamped to it.
  leftWristX: number;
  leftWristY: number;
  rightWristX: number;
  rightWristY: number;
  // Legs: 0 standing, 1 thigh lifted to horizontal (knee rises toward hip height, ankle follows).
  leftKnee: number;
  rightKnee: number;
  // Hands: 0 open .. 1 fist; visibility 1 = hand landmarks present this frame.
  leftFist: number;
  rightFist: number;
  leftHandVisible: number;
  rightHandVisible: number;
  /**
   * Hands-only mode (climbing: close to the camera, no pose). When >= 0.5 the body is absent and
   * hands are placed directly: palm centre in mirrored normalised image coords, size = palm length
   * as a fraction of image height.
   */
  handsOnly: number;
  leftHandX: number;
  leftHandY: number;
  rightHandX: number;
  rightHandY: number;
  /** About 0.16 at 1 m. */
  handSize: number;
}

export const CONTROL_KEYS: readonly (keyof BodyControls)[] = [
  'bodyVisible',
  'centreX',
  'shoulderY',
  'shoulderWidth',
  'lean',
  'crouch',
  'jump',
  'leftWristX',
  'leftWristY',
  'rightWristX',
  'rightWristY',
  'leftKnee',
  'rightKnee',
  'leftFist',
  'rightFist',
  'leftHandVisible',
  'rightHandVisible',
  'handsOnly',
  'leftHandX',
  'leftHandY',
  'rightHandX',
  'rightHandY',
  'handSize',
];

/** Relaxed standing pose, arms hanging, hands open and visible. */
export function defaultControls(): BodyControls {
  return {
    bodyVisible: 1,
    centreX: 0.5,
    shoulderY: 0.32,
    shoulderWidth: 0.13,
    lean: 0,
    crouch: 0,
    jump: 0,
    leftWristX: -0.12,
    leftWristY: -1.4,
    rightWristX: 0.12,
    rightWristY: -1.4,
    leftKnee: 0,
    rightKnee: 0,
    leftFist: 0,
    rightFist: 0,
    leftHandVisible: 1,
    rightHandVisible: 1,
    handsOnly: 0,
    leftHandX: 0.35,
    leftHandY: 0.55,
    rightHandX: 0.65,
    rightHandY: 0.55,
    handSize: 0.16,
  };
}
