import type { ClimbingConfig } from './config';

/** Result holder for the mappings; reuse one so nothing allocates. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * A hand's image position (mirrored normalised, y down) to its cursor on the wall, in metres
 * relative to the climber's shoulder centre. The middle of the image is a little above the
 * shoulders; the top of the image is a full stretch up.
 */
export function handToWall(
  cfg: Pick<ClimbingConfig, 'reachWidth' | 'reachHeight' | 'reachOffsetY'>,
  handX: number,
  handY: number,
  out: Vec2,
): Vec2 {
  out.x = (handX - 0.5) * cfg.reachWidth;
  out.y = (0.5 - handY) * cfg.reachHeight + cfg.reachOffsetY;
  return out;
}

/** Inverse of `handToWall`: the image position that puts the cursor at a wall offset. */
export function wallToHand(
  cfg: Pick<ClimbingConfig, 'reachWidth' | 'reachHeight' | 'reachOffsetY'>,
  wallX: number,
  wallY: number,
  out: Vec2,
): Vec2 {
  out.x = wallX / cfg.reachWidth + 0.5;
  out.y = 0.5 - (wallY - cfg.reachOffsetY) / cfg.reachHeight;
  return out;
}
