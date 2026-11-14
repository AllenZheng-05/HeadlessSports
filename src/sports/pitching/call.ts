import type { PitchKind } from './aim';
import { GRID, cellCol, cellRow } from './zone';

export const KIND_LABEL: Record<PitchKind, string> = { fastball: 'Fastball', curve: 'Curve' };

/** Where the catcher wants it, in words for the player facing the screen: "high and left". */
export function locationPhrase(cell: number): string {
  const row = cellRow(cell);
  const col = cellCol(cell);
  const v = row === 0 ? 'high' : row === GRID - 1 ? 'low' : '';
  const h = col === 0 ? 'left' : col === GRID - 1 ? 'right' : '';
  if (v !== '' && h !== '') return `${v} and ${h}`;
  if (v !== '') return `${v} in the middle`;
  if (h !== '') return `${h} side`;
  return 'down the middle';
}

/** The catcher's call: "Fastball, high and left". Built once per pitch. */
export function callText(kind: PitchKind, cell: number): string {
  return `${KIND_LABEL[kind]}, ${locationPhrase(cell)}`;
}

/** The catcher's reaction once the pitch has landed. */
export function reactionText(matched: boolean, balk: boolean, landed = true): string {
  if (balk) return 'No pitch. Take your time';
  if (!matched) return 'Not what I called';
  return landed ? 'Nice' : 'Right pitch, off the spot';
}
