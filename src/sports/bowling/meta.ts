import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'bowling',
  title: 'Bowling',
  tagline: 'Swing low and roll a strike.',
  accent: ACCENTS.bowling,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'full-body',
  seatedOk: false,
  needsSpace: true,
  score: { label: 'Score', unit: 'pts', decimals: 0, higherIsBetter: true },
  howTo: [
    'Close your fist to pick up the ball.',
    'Step left or right to line up.',
    'Swing your arm back and forward, low, like a real bowler.',
  ],
  debugKeys: [
    'E / Q: close right / left fist (pick up)',
    'Left / Right arrows: step sideways',
    'B (hold, release): bowl, longer hold is faster',
    'Mouse x: aim. Z / C: hook left / right',
  ],
};
