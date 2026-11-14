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
  needsSpace: false,
  score: { label: 'Height', unit: 'm', decimals: 1, higherIsBetter: true },
  howTo: [
    'Hold both hands up close to the camera.',
    'Close a hand on a hold to grab it, then pull it down to climb.',
    'Reach up with the other hand. Rest on the ledges.',
  ],
  debugKeys: [
    'A / D: select left / right hand',
    'Mouse: move the selected hand',
    'Q / E: toggle left / right fist',
    'Mouse button: close the selected hand',
  ],
};
