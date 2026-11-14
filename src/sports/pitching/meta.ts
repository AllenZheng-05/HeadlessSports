import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'pitching',
  title: 'Pitching',
  tagline: 'Pick a pitch and hit the mitt.',
  accent: ACCENTS.pitching,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'full-body',
  seatedOk: false,
  needsSpace: true,
  score: { label: 'Score', unit: 'pts', decimals: 0, higherIsBetter: true },
  howTo: [
    'Hold your throwing hand still: a fist is a fastball, an open hand is a curve',
    'Wind up and throw overarm at the lit square. Nice and easy does it',
    'Release further out or higher to move the ball that way',
  ],
  debugKeys: [
    'E / Q: toggle the right / left fist (closed fastball, open curve), then hold still',
    'Hold T, release: the pitch (longer hold is faster, but speed only counts to a point)',
    'Mouse left and right: pitch left and right; up and down: high and low',
    'Z / C: curve the pitch a little',
  ],
};
