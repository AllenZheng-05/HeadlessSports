import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'archery',
  title: 'Archery',
  tagline: 'Draw, aim and let the arrow fly.',
  accent: ACCENTS.archery,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'upper-body',
  seatedOk: true,
  needsSpace: false,
  score: { label: 'Score', unit: 'pts', decimals: 0, higherIsBetter: true },
  howTo: [
    'Hold your bow arm out to the side.',
    'Close your other fist next to it, then pull back to draw. Aim with the bow arm.',
    'Open your hand to let the arrow go.',
  ],
  debugKeys: [
    'A: pick the left hand, then move the mouse to place it',
    'D: pick the right hand, then move the mouse to place it',
    'E: close the right fist near the left hand to nock, drag away to draw',
    'A, mouse: fine-aim with the left hand while drawing',
    'E again: open the fist to release',
    'Q: toggle the left fist',
  ],
};
