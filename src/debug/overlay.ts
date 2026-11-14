import type { InputState } from '../input/types';
import { HAND_STRIDE, POSE_STRIDE } from '../tracking/types';

/** Raw (unfiltered) data of the newest frame, copied in by the frame listener. */
export interface OverlayData {
  rawHasPose: boolean;
  rawPose: Float32Array;
  rawHands: [Float32Array, Float32Array];
  rawHandPresent: [boolean, boolean];
}

const POSE_LINES = new Uint8Array([
  11, 12, 11, 13, 13, 15, 12, 14, 14, 16, 11, 23, 12, 24, 23, 24, 23, 25, 25, 27, 24, 26, 26, 28,
  27, 29, 29, 31, 27, 31, 28, 30, 30, 32, 28, 32,
]);

const POSE_JOINTS = new Uint8Array([
  0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
]);

const HAND_LINES = new Uint8Array([
  0, 1, 1, 2, 2, 3, 3, 4, 0, 5, 5, 6, 6, 7, 7, 8, 5, 9, 9, 10, 10, 11, 11, 12, 9, 13, 13, 14, 14,
  15, 15, 16, 13, 17, 17, 18, 18, 19, 19, 20, 0, 17,
]);

const VISIBLE = 0.5;
const FAINT = 0.25;

const COL_SKELETON = '#8fd694';
const COL_JOINT = '#fbf8f1';
const COL_RAW = '#bfe3f7';
const COL_HAND = '#fbf8f1';
const COL_WHISTLE = '#ff7a59';

export function createOverlayData(): OverlayData {
  return {
    rawHasPose: false,
    rawPose: new Float32Array(33 * POSE_STRIDE),
    rawHands: [new Float32Array(21 * HAND_STRIDE), new Float32Array(21 * HAND_STRIDE)],
    rawHandPresent: [false, false],
  };
}

function drawPoseLines(
  ctx: CanvasRenderingContext2D,
  pose: Float32Array,
  w: number,
  h: number,
): void {
  for (let i = 0; i < POSE_LINES.length; i += 2) {
    const a = POSE_LINES[i] * POSE_STRIDE;
    const b = POSE_LINES[i + 1] * POSE_STRIDE;
    const vis = Math.min(pose[a + 3], pose[b + 3]);
    ctx.globalAlpha = vis >= VISIBLE ? 1 : FAINT;
    ctx.beginPath();
    ctx.moveTo(pose[a] * w, pose[a + 1] * h);
    ctx.lineTo(pose[b] * w, pose[b + 1] * h);
    ctx.stroke();
  }
}

function drawJoints(
  ctx: CanvasRenderingContext2D,
  pose: Float32Array,
  w: number,
  h: number,
  radius: number,
): void {
  for (const joint of POSE_JOINTS) {
    const o = joint * POSE_STRIDE;
    ctx.globalAlpha = pose[o + 3] >= VISIBLE ? 1 : FAINT;
    ctx.beginPath();
    ctx.arc(pose[o] * w, pose[o + 1] * h, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  lm: Float32Array,
  w: number,
  h: number,
  unit: number,
): void {
  ctx.strokeStyle = COL_HAND;
  ctx.lineWidth = Math.max(1, unit * 0.5);
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < HAND_LINES.length; i += 2) {
    const a = HAND_LINES[i] * HAND_STRIDE;
    const b = HAND_LINES[i + 1] * HAND_STRIDE;
    ctx.beginPath();
    ctx.moveTo(lm[a] * w, lm[a + 1] * h);
    ctx.lineTo(lm[b] * w, lm[b + 1] * h);
    ctx.stroke();
  }
  ctx.fillStyle = COL_HAND;
  ctx.globalAlpha = 1;
  for (let i = 0; i < 21; i++) {
    ctx.beginPath();
    ctx.arc(lm[i * HAND_STRIDE] * w, lm[i * HAND_STRIDE + 1] * h, unit * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  closed: boolean,
  unit: number,
): void {
  ctx.strokeStyle = closed ? COL_WHISTLE : COL_JOINT;
  ctx.lineWidth = closed ? unit * 1.6 : unit * 0.7;
  ctx.globalAlpha = closed ? 1 : 0.7;
  ctx.beginPath();
  ctx.arc(x * w, y * h, h * 0.045, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Draws in mirrored-normalised coordinates onto a canvas that exactly covers the (CSS-mirrored)
 * video. Not flipped here: the landmarks are already mirrored. No allocation.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  state: InputState,
  data: OverlayData,
): void {
  ctx.clearRect(0, 0, w, h);
  const unit = Math.max(2, h / 180);
  ctx.lineCap = 'round';

  // Filtered skeleton.
  if (state.hasPose) {
    ctx.strokeStyle = COL_SKELETON;
    ctx.lineWidth = unit * 1.4;
    drawPoseLines(ctx, state.pose, w, h);
    ctx.fillStyle = COL_JOINT;
    drawJoints(ctx, state.pose, w, h, unit * 1.3);
  }

  // Raw joints as small dots.
  if (data.rawHasPose) {
    ctx.fillStyle = COL_RAW;
    drawJoints(ctx, data.rawPose, w, h, unit * 0.65);
  }

  // Hands and palm centres.
  if (data.rawHandPresent[0]) drawHand(ctx, data.rawHands[0], w, h, unit);
  if (data.rawHandPresent[1]) drawHand(ctx, data.rawHands[1], w, h, unit);
  if (state.hands.left.present) {
    drawRing(ctx, state.hands.left.x, state.hands.left.y, w, h, state.hands.left.closed, unit);
  }
  if (state.hands.right.present) {
    drawRing(ctx, state.hands.right.x, state.hands.right.y, w, h, state.hands.right.closed, unit);
  }
  ctx.globalAlpha = 1;
}
