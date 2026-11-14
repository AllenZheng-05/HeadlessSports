import type { PitchingConfig } from './config';

/** Zone geometry. Plane coordinates: x metres toward screen right, y metres above the ground. */
export interface Point {
  x: number;
  y: number;
}

export const GRID = 3;
export const CELLS = GRID * GRID;
const EPS = 1e-9;

/** Cells are numbered row * 3 + col, row 0 on top, col 0 on screen left. */
export const cellRow = (cell: number): number => Math.floor(cell / GRID);
export const cellCol = (cell: number): number => cell % GRID;
export const isCorner = (cell: number): boolean =>
  (cellRow(cell) === 0 || cellRow(cell) === GRID - 1) &&
  (cellCol(cell) === 0 || cellCol(cell) === GRID - 1);

/** Centre of a cell. */
export function cellCentre(cfg: PitchingConfig, cell: number, out: Point): Point {
  const cw = cfg.zoneWidth / GRID;
  const ch = cfg.zoneHeight / GRID;
  out.x = (cellCol(cell) - (GRID - 1) / 2) * cw;
  out.y = cfg.zoneCentreY + ((GRID - 1) / 2 - cellRow(cell)) * ch;
  return out;
}

/** The cell containing the point, or -1 outside the zone. Shared edges go to the right and lower cell. */
export function cellAt(cfg: PitchingConfig, x: number, y: number): number {
  const hw = cfg.zoneWidth / 2;
  const hh = cfg.zoneHeight / 2;
  const dy = y - cfg.zoneCentreY;
  if (Math.abs(x) > hw + EPS || Math.abs(dy) > hh + EPS) return -1;
  const cw = cfg.zoneWidth / GRID;
  const ch = cfg.zoneHeight / GRID;
  let col = Math.floor((x + hw + EPS) / cw);
  let row = Math.floor((hh - dy + EPS) / ch);
  col = Math.min(GRID - 1, Math.max(0, col));
  row = Math.min(GRID - 1, Math.max(0, row));
  return row * GRID + col;
}

/** True for a cell next to `a`, diagonals included, and not `a` itself. */
export function adjacent(a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0) return false;
  return Math.abs(cellRow(a) - cellRow(b)) <= 1 && Math.abs(cellCol(a) - cellCol(b)) <= 1;
}

/** Distance from the zone rectangle, m; 0 inside it. */
export function distanceOutsideZone(cfg: PitchingConfig, x: number, y: number): number {
  const ox = Math.max(0, Math.abs(x) - cfg.zoneWidth / 2);
  const oy = Math.max(0, Math.abs(y - cfg.zoneCentreY) - cfg.zoneHeight / 2);
  return Math.hypot(ox, oy);
}
