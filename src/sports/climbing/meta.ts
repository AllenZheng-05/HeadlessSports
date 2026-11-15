import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'climbing',
  title: 'Rock climbing',
  tagline: 'Reach up and grab the holds.',
  accent: ACCENTS.climbing,
  requiredTrackers: { pose: false, handCrops: false, fullFrameHands: true },
  stance: 'hands-close',
  seatedOk: true,
  usesHandedness: false,
  needsSpace: false,
  score: { label: 'Height', unit: 'm', decimals: 1, higherIsBetter: true },
  howTo: [
    'Hold both hands up close to the camera.',
    'Close a hand on a hold to grab it, then pull it down to climb.',
    'Reach up with the other hand. Rest on the ledges.',
  ],
  debugKeys: [
    'Press and hold a hold to grab it. Your other hand lets go, so drag down to pull up',
    'Letting go of the button keeps your grip and switches to the free hand',
  ],
};
