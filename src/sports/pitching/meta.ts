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
    'Read the call. Fist for a fastball, open hand for a curve, held still',
    'Point your glove hand where you want it. Throw with your other arm: faster is faster, and your release nudges it',
    'Throw what was called for bonus points',
  ],
  debugKeys: [
    'Click Fastball or Curveball (the catcher calls one for bonus points)',
    'Press and hold on the field to aim the ring, let go to throw',
  ],
  hasTutorial: true,
  multiplayer: { turnLabel: 'set of pitches', maxPlayers: 4 },
};
