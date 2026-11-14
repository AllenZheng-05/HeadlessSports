/**
 * Shared contract for the tracking layer. Types and constants only.
 *
 * Conventions (see CLAUDE.md):
 * - x and y are normalised image coordinates, ALREADY MIRRORED: x grows toward screen right as
 *   the player sees themselves in a mirror, y grows downward. The tracking layer applies the
 *   flip once; nothing downstream flips again.
 * - Normalised coordinates are not isotropic. Multiply x by `aspect` (image width / height)
 *   before measuring distances or angles.
 * - Landmark indices keep MediaPipe's anatomical meaning (LEFT_WRIST is the player's left wrist,
 *   which appears on screen left).
 * - `t` is game ms. For the camera source it comes from the camera clock on the
 *   performance.now() timeline. Never stamp frames with the time inference finished.
 */

export const POSE_COUNT = 33;
/** x, y, z, visibility */
export const POSE_STRIDE = 4;
/** x, y, z in metres, hip-centred, x mirrored like the 2D landmarks */
export const WORLD_STRIDE = 3;
export const HAND_COUNT = 21;
/** x, y, z in full-image normalised coordinates (mirrored) */
export const HAND_STRIDE = 3;

export const PoseIndex = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export const HandIndex = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Index into `LandmarkFrame.hands`: the player's left hand is 0, right hand is 1. */
export const HAND_LEFT = 0;
export const HAND_RIGHT = 1;

/** Which trackers a sport (or sport phase) needs. The source loads only these. */
export interface TrackerNeeds {
  /** Pose Landmarker on every frame. */
  pose: boolean;
  /** Hand Landmarker on wrist crops taken from the full-resolution frame (needs `pose`). */
  handCrops: boolean;
  /** Hand Landmarker on the full frame, two hands, no pose (climbing). */
  fullFrameHands: boolean;
}

export interface HandObservation {
  /** False when the hand was not tracked this frame; `landmarks` then holds stale data. */
  present: boolean;
  /** Detector confidence 0..1, 0 when not present. */
  score: number;
  /** HAND_COUNT * HAND_STRIDE values. */
  landmarks: Float32Array;
}

/**
 * One tracking result. The source owns and REUSES this object and its arrays: it is valid only
 * during the listener callback. Copy what you need to keep.
 */
export interface LandmarkFrame {
  /** Capture time, game ms. */
  t: number;
  /** Increments by one per delivered frame. */
  seq: number;
  /** Time spent in inference for this frame, ms (0 for synthetic and replay). */
  inferenceMs: number;
  /** Image width / height. */
  aspect: number;
  /** False when pose was not requested or no body was detected; `pose` then holds stale data. */
  hasPose: boolean;
  /** POSE_COUNT * POSE_STRIDE values. */
  pose: Float32Array;
  /** POSE_COUNT * WORLD_STRIDE values. Coarse; never score on z. */
  poseWorld: Float32Array;
  /** [left, right]. */
  hands: readonly [HandObservation, HandObservation];
}

export type FrameListener = (frame: LandmarkFrame) => void;

/** Mutated in place by the source; read it whenever you like. */
export interface TrackingStats {
  /** Median inference time over the last second or so, ms. */
  inferenceMs: number;
  /** Delivered frames per second. */
  trackingHz: number;
  /** Estimated capture-to-delivery latency, ms (0 for synthetic and replay). */
  latencyMs: number;
  /** Frames skipped because the tracker was still busy. */
  droppedFrames: number;
  delegate: 'GPU' | 'CPU' | 'none';
  /** False when the main-thread fallback is in use. */
  inWorker: boolean;
}

export type LandmarkSourceKind = 'camera' | 'replay' | 'synthetic';

/**
 * The one interface the input layer consumes landmarks through. Three implementations:
 * the camera plus tracking worker, the clip replayer, and the synthetic player.
 */
export interface LandmarkSource {
  readonly kind: LandmarkSourceKind;
  /** The mirrored-on-display camera element, or null for sources without video. */
  readonly video: HTMLVideoElement | null;
  readonly stats: TrackingStats;
  /** Acquire resources and begin producing frames. Rejects with a `TrackingError`. */
  start(needs: TrackerNeeds): Promise<void>;
  /** Load and close trackers to match. Resolves when the new set is ready. */
  setNeeds(needs: TrackerNeeds): Promise<void>;
  /**
   * Called once per rendered frame with the current game time. Stepped sources (synthetic,
   * replay) deliver every frame due up to `nowMs` from inside this call. The camera source
   * delivers frames as they arrive and treats this as a no-op.
   */
  pump(nowMs: number): void;
  subscribe(listener: FrameListener): () => void;
  /** Stop producing frames and release the camera, worker and models. */
  stop(): void;
}

export type TrackingErrorCode =
  | 'camera-denied'
  | 'camera-missing'
  | 'camera-in-use'
  | 'camera-low-resolution'
  | 'model-load-failed'
  | 'worker-failed'
  | 'unsupported';

export interface TrackingError extends Error {
  code: TrackingErrorCode;
}

/** JSON format written by the recorder and read by the replayer. */
export interface LandmarkClip {
  version: 1;
  name: string;
  /** ISO date. */
  createdAt: string;
  /** 'camera' for real recordings; 'synthetic' marks a placeholder to be replaced. */
  origin: 'camera' | 'synthetic';
  aspect: number;
  needs: TrackerNeeds;
  frames: ClipFrame[];
}

export interface ClipFrame {
  /** ms since the first frame of the clip. */
  t: number;
  /** POSE_COUNT * POSE_STRIDE numbers rounded to 4 decimals, or null when no pose. */
  pose: number[] | null;
  /** POSE_COUNT * WORLD_STRIDE numbers rounded to 4 decimals, or null. */
  world: number[] | null;
  /** [left, right], each HAND_COUNT * HAND_STRIDE numbers or null. */
  hands: [number[] | null, number[] | null];
}
