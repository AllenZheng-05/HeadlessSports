/**
 * Distance display for batting. Physics stays in metres; the score, the saved personal best and
 * everything the player reads are whole feet. Conversion happens once, at the scoring boundary
 * (round.ts), and formatting once, at the display boundary (index.ts).
 */

/** Exact by definition: 1 ft = 0.3048 m. */
export const FEET_PER_METRE = 1 / 0.3048;

/** A metre distance as whole feet, as scored. */
export function metresToFeet(metres: number): number {
  return Math.round(metres * FEET_PER_METRE);
}

/** A whole-feet number as the player reads it, e.g. '412 ft'. */
export function formatFeet(feet: number): string {
  return `${feet} ft`;
}
