import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'javelin',
  title: 'Javelin',
  tagline: 'Run, plant and throw far.',
  accent: ACCENTS.javelin,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'full-body',
  seatedOk: false,
  needsSpace: true,
  score: { label: 'Distance', unit: 'm', decimals: 2, higherIsBetter: true },
  howTo: [
    'Raise a fist above your head to start',
    'Run on the spot: lift your knees',
    'Throw before the line',
  ],
  debugKeys: [
    'U: raise the arm to start (E first for a fist)',
    'Hold Up arrow: run (Shift: sprint), or tap R',
    'Hold T, release: overarm throw (longer hold is harder)',
    'Mouse up and down: loft',
  ],
};
