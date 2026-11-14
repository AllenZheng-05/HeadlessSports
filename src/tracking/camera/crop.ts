/** Pure wrist-crop maths. Inputs are raw (unmirrored) normalised coordinates. */

export interface CropRect {
  /** Top-left in full-image pixels. */
  x: number;
  y: number;
  /** Side of the square in pixels. */
  side: number;
}

export const MIN_CROP_PX = 64;
export const CROP_CENTRE_EXTEND = 0.35;
export const CROP_SIDE_PER_FOREARM = 1.8;

export function createCropRect(): CropRect {
  return { x: 0, y: 0, side: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Square crop centred slightly beyond the wrist along the elbow-to-wrist direction, with side
 * 1.8 x forearm length, at least 64 px, at most the shorter image side, shifted to stay inside.
 * Returns false when the inputs are unusable (non-finite, wrist outside the image, zero forearm).
 */
export function computeWristCrop(
  wristX: number,
  wristY: number,
  elbowX: number,
  elbowY: number,
  imgW: number,
  imgH: number,
  out: CropRect,
): boolean {
  if (!(imgW > 0 && imgH > 0)) return false;
  if (!(wristX >= 0 && wristX <= 1 && wristY >= 0 && wristY <= 1)) return false;
  const dx = (wristX - elbowX) * imgW;
  const dy = (wristY - elbowY) * imgH;
  const forearm = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(forearm) || forearm < 1) return false;
  const maxSide = Math.min(imgW, imgH);
  const side = clamp(CROP_SIDE_PER_FOREARM * forearm, Math.min(MIN_CROP_PX, maxSide), maxSide);
  const cx = wristX * imgW + CROP_CENTRE_EXTEND * dx;
  const cy = wristY * imgH + CROP_CENTRE_EXTEND * dy;
  out.side = side;
  out.x = clamp(cx - side / 2, 0, imgW - side);
  out.y = clamp(cy - side / 2, 0, imgH - side);
  return true;
}

/** Crop-normalised x (0..1 within the crop) to full-image normalised x. */
export function cropToImageX(rect: CropRect, lx: number, imgW: number): number {
  return (rect.x + lx * rect.side) / imgW;
}

export function cropToImageY(rect: CropRect, ly: number, imgH: number): number {
  return (rect.y + ly * rect.side) / imgH;
}
