import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'javelin',
  title: 'Javelin',
  tagline: 'Run, plant and throw far.',
  accent: ACCENTS.javelin,
  requiredTrackers: { pose: true, handCrops: false, fullFrameHands: false },
  stance: 'full-body',
  seatedOk: false,
  needsSpace: true,
  score: { label: 'Distance', unit: 'm', decimals: 2, higherIsBetter: true },
  howTo: [
    'Run on the spot: faster feet, faster athlete',
    'Swing your dominant arm hard overhead to throw',
    'Throw before the foul line',
  ],
  debugKeys: ['Hold the button to run', 'Let go just before the line to throw'],
};
