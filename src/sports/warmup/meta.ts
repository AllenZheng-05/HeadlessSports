import type { SportMeta } from '../../core/sport';
import { PALETTE } from '../../render/style/palette';

/** Tiny and eager: the menu imports this, never the sport's code. */
export const meta: SportMeta = {
  id: 'warmup',
  title: 'Warm-up',
  tagline: 'Pump your fist five times, fast.',
  accent: PALETTE.whistle,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'upper-body',
  seatedOk: true,
  needsSpace: false,
  score: { label: 'Time', unit: 's', decimals: 1, higherIsBetter: false },
  howTo: ['Close your fist, then open it.', 'Do it five times as fast as you can.'],
  debugKeys: ['E: toggle right fist', 'Q: toggle left fist'],
};
