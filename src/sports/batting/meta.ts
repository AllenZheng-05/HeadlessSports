import type { SportMeta } from '../../core/sport';
import { ACCENTS } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'batting',
  scoreKey: 'batting-ft',
  title: 'Batting',
  tagline: 'Time your swing to hit a homer.',
  accent: ACCENTS.batting,
  requiredTrackers: { pose: true, handCrops: false, fullFrameHands: false },
  stance: 'full-body',
  seatedOk: false,
  needsSpace: true,
  score: { label: 'Distance', unit: 'ft', decimals: 0, higherIsBetter: true },
  howTo: [
    'Hold both hands together like a bat',
    'Swing as the ball arrives',
    'Higher hands lift the ball',
  ],
  debugKeys: ['Click to swing as the ball reaches the plate'],
  hasTutorial: true,
};
