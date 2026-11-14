import { HAND_COUNT, HAND_STRIDE, POSE_COUNT, POSE_STRIDE, WORLD_STRIDE } from '../types';
import type { LandmarkFrame, TrackerNeeds } from '../types';

/** Hand-crop debug images are opt-in; nothing extra is allocated unless this is switched on. */
export const HAND_CROP_DEBUG = false;

/** Debug-only surface of the camera source (used by the debug page). */
export interface CameraDebug {
  setDebugCrops(enabled: boolean): void;
  onDebugCrops(cb: (left: ImageBitmap | null, right: ImageBitmap | null) => void): () => void;
}

export type PoseModelName = 'lite' | 'full';
export type DelegateName = 'GPU' | 'CPU';
/**
 * 'both' crops and tracks both hands every frame. 'alternate' crops one hand per frame, so each
 * hand is observed every other frame; on the frames a hand is skipped it is reported as not
 * present (the input layer keeps that hand's last known state meanwhile).
 */
export type HandCropMode = 'both' | 'alternate';

export interface CoreOptions {
  wasmBase: string;
  modelBase: string;
  poseModel: PoseModelName;
  delegate: DelegateName;
  handCropMode: HandCropMode;
  poseInputWidth: number;
  handCropSize: number;
}

// ---- Main -> worker ----

export interface InitMsg {
  type: 'init';
  options: CoreOptions;
  needs: TrackerNeeds;
  debug: boolean;
}
export interface NeedsMsg {
  type: 'needs';
  needs: TrackerNeeds;
}
export interface FrameMsg {
  type: 'frame';
  bitmap: ImageBitmap;
  t: number;
  buffer: Float32Array;
}
export interface DebugMsg {
  type: 'debug';
  enabled: boolean;
}
export interface StopMsg {
  type: 'stop';
}
export type ToWorker = InitMsg | NeedsMsg | FrameMsg | DebugMsg | StopMsg;

// ---- Worker -> main ----

export interface ReadyMsg {
  type: 'ready';
  delegate: DelegateName;
}
export interface NeedsReadyMsg {
  type: 'needs-ready';
  delegate: DelegateName;
}
export interface ResultMsg {
  type: 'result';
  ok: boolean;
  buffer: Float32Array;
  dbgLeft: ImageBitmap | null;
  dbgRight: ImageBitmap | null;
}
export interface ErrorMsg {
  type: 'error';
  /** 'init' errors trigger the main-thread fallback; 'needs' and 'frame' are reported. */
  phase: 'init' | 'needs' | 'frame';
  message: string;
}
export type FromWorker = ReadyMsg | NeedsReadyMsg | ResultMsg | ErrorMsg;

// ---- Packed frame layout (one Float32Array per frame) ----
//
// [0] inferenceMs  [1] aspect  [2] hasPose  [3] hand0 present  [4] hand0 score
// [5] hand1 present  [6] hand1 score  [7] reserved
// then POSE (33*4), WORLD (33*3), HAND0 (21*3), HAND1 (21*3).
// `t` and `seq` never travel in the buffer (float32 cannot hold game ms precisely).

export const HEADER_LEN = 8;
export const H_INFERENCE_MS = 0;
export const H_ASPECT = 1;
export const H_HAS_POSE = 2;
export const H_HAND_PRESENT = 3; // + 2 * handIndex
export const H_HAND_SCORE = 4; // + 2 * handIndex
export const POSE_OFFSET = HEADER_LEN;
export const WORLD_OFFSET = POSE_OFFSET + POSE_COUNT * POSE_STRIDE;
export const HANDS_OFFSET = WORLD_OFFSET + POSE_COUNT * WORLD_STRIDE;
export const HAND_LEN = HAND_COUNT * HAND_STRIDE;
export const PACKED_LEN = HANDS_OFFSET + 2 * HAND_LEN;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}
export interface PosePoint extends Point3 {
  visibility: number;
}

/** Writes the mirrored pose (x -> 1 - x) and mirrored world landmarks (x negated). */
export function packPose(
  buf: Float32Array,
  landmarks: ArrayLike<PosePoint>,
  world: ArrayLike<Point3>,
): void {
  for (let i = 0; i < POSE_COUNT; i++) {
    const p = landmarks[i];
    const o = POSE_OFFSET + i * POSE_STRIDE;
    buf[o] = 1 - p.x;
    buf[o + 1] = p.y;
    buf[o + 2] = p.z;
    buf[o + 3] = p.visibility;
    const w = world[i];
    const wo = WORLD_OFFSET + i * WORLD_STRIDE;
    buf[wo] = -w.x;
    buf[wo + 1] = w.y;
    buf[wo + 2] = w.z;
  }
}

/** Copies a hand from the tracker's own (already mirrored) state into the packed buffer. */
export function packHand(
  buf: Float32Array,
  hand: number,
  present: boolean,
  score: number,
  landmarks: Float32Array,
  landmarksOffset: number,
): void {
  buf[H_HAND_PRESENT + 2 * hand] = present ? 1 : 0;
  buf[H_HAND_SCORE + 2 * hand] = present ? score : 0;
  const o = HANDS_OFFSET + hand * HAND_LEN;
  for (let i = 0; i < HAND_LEN; i++) buf[o + i] = landmarks[landmarksOffset + i];
}

/**
 * Copies a packed buffer into the single reused LandmarkFrame. Pose and hand arrays are only
 * overwritten when present, so stale data is left in place as the contract describes.
 */
export function unpackFrame(buf: Float32Array, frame: LandmarkFrame): void {
  frame.inferenceMs = buf[H_INFERENCE_MS];
  frame.aspect = buf[H_ASPECT];
  frame.hasPose = buf[H_HAS_POSE] === 1;
  if (frame.hasPose) {
    const pose = frame.pose;
    for (let i = 0; i < POSE_COUNT * POSE_STRIDE; i++) pose[i] = buf[POSE_OFFSET + i];
    const world = frame.poseWorld;
    for (let i = 0; i < POSE_COUNT * WORLD_STRIDE; i++) world[i] = buf[WORLD_OFFSET + i];
  }
  for (let h = 0; h < 2; h++) {
    const obs = frame.hands[h];
    const present = buf[H_HAND_PRESENT + 2 * h] === 1;
    // `present` and `score` are writable at runtime; the contract only marks the tuple readonly.
    obs.present = present;
    obs.score = present ? buf[H_HAND_SCORE + 2 * h] : 0;
    if (present) {
      const o = HANDS_OFFSET + h * HAND_LEN;
      const lm = obs.landmarks;
      for (let i = 0; i < HAND_LEN; i++) lm[i] = buf[o + i];
    }
  }
}

/** Builds the one LandmarkFrame the source reuses for its whole life. */
export function createFrame(): LandmarkFrame {
  return {
    t: 0,
    seq: 0,
    inferenceMs: 0,
    aspect: 16 / 9,
    hasPose: false,
    pose: new Float32Array(POSE_COUNT * POSE_STRIDE),
    poseWorld: new Float32Array(POSE_COUNT * WORLD_STRIDE),
    hands: [
      { present: false, score: 0, landmarks: new Float32Array(HAND_LEN) },
      { present: false, score: 0, landmarks: new Float32Array(HAND_LEN) },
    ],
  };
}

/**
 * Runs async tasks strictly one at a time, in order. `cancelAll` rejects every queued and running
 * request at once (the queued ones never start) and lets later requests start immediately, so a
 * stuck task cannot block a restart. A cancelled running task keeps going in the background; its
 * owner must discard its result.
 */
export class RequestChain {
  private tail: Promise<void> = Promise.resolve();
  private readonly entries = new Set<{ cancelled: boolean; reject: (err: Error) => void }>();

  run<T>(task: () => Promise<T>): Promise<T> {
    const entry = { cancelled: false, reject: (_err: Error): void => undefined };
    const out = new Promise<T>((resolve, reject) => {
      entry.reject = reject;
      this.tail = this.tail.then(() => {
        if (entry.cancelled) return undefined;
        let p: Promise<T>;
        try {
          p = task();
        } catch (err) {
          p = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        return p.then(resolve, reject);
      });
    });
    this.entries.add(entry);
    const forget = (): void => {
      this.entries.delete(entry);
    };
    out.then(forget, forget);
    return out;
  }

  cancelAll(err: Error): void {
    const list = [...this.entries];
    this.entries.clear();
    this.tail = Promise.resolve();
    for (const e of list) {
      e.cancelled = true;
      e.reject(err);
    }
  }
}
