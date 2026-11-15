import type { Vec2 } from './reach';

/**
 * Screen to wall mapping for mouse play: a true unprojection of the pointer through the (look-down
 * -z, unrotated) perspective camera onto the plane the holds sit on. Everything is plain numbers so
 * nothing allocates; refresh it with `updateScreenMap` whenever the camera moves or resizes.
 *
 * Pointer coordinates are 0..1 over the viewport, y down (the same space as `MouseControl`).
 */
export interface ScreenMap {
  /** Camera position and the distance from it to the hold plane. */
  camX: number;
  camY: number;
  dist: number;
  /** Half the visible wall size on the hold plane, metres. */
  halfW: number;
  halfH: number;
}

export function createScreenMap(): ScreenMap {
  return { camX: 0, camY: 0, dist: 1, halfW: 1, halfH: 1 };
}

export function updateScreenMap(
  map: ScreenMap,
  camX: number,
  camY: number,
  camZ: number,
  planeZ: number,
  fovDeg: number,
  aspect: number,
): void {
  map.camX = camX;
  map.camY = camY;
  map.dist = camZ - planeZ;
  map.halfH = map.dist * Math.tan((fovDeg * Math.PI) / 360);
  map.halfW = map.halfH * aspect;
}

/** World wall position under a pointer position. */
export function screenToWall(map: ScreenMap, px: number, py: number, out: Vec2): Vec2 {
  out.x = map.camX + (px * 2 - 1) * map.halfW;
  out.y = map.camY + (1 - py * 2) * map.halfH;
  return out;
}

/** Pointer position at which a world wall point appears on screen. */
export function wallToScreen(map: ScreenMap, wx: number, wy: number, out: Vec2): Vec2 {
  out.x = ((wx - map.camX) / map.halfW + 1) / 2;
  out.y = (1 - (wy - map.camY) / map.halfH) / 2;
  return out;
}
