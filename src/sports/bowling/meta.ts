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
  hasTutorial: true,
  score: { label: 'Score', unit: 'pts', decimals: 0, higherIsBetter: true },
  howTo: [
    'Close your fist to pick up the ball.',
    'Step or move your hand to line up the arrows.',
    'Swing your arm back and forward, low, like a real bowler.',
  ],
  debugKeys: ['Move the mouse to aim the arrows', 'Hold the button to wind up, let go to bowl'],
};
