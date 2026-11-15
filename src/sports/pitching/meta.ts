import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'pitching',
  title: 'Pitching',
  tagline: 'Throw the pitch the catcher calls.',
  accent: ACCENTS.pitching,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'full-body',
  seatedOk: false,
  needsSpace: true,
  score: { label: 'Score', unit: 'pts', decimals: 0, higherIsBetter: true },
  howTo: [
    'Read the call above the catcher. Fist for a fastball, open hand for a curve, held still',
    'Wind up and throw. The ring shows where the pitch will go',
    'Throw what was called for bonus points',
  ],
  debugKeys: [
    'Click Fastball or Curveball (the catcher calls one for bonus points)',
    'Press and hold on the field to aim the ring, let go to throw',
  ],
};
