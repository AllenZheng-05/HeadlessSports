import type { RecognizerConfig } from '../../input/recognizers/config';
import type { Side } from '../../input/types';
import { sideSign } from './stance';

/**
 * The swing recognizer settings batting wants while it is on: the batter faces the plate (screen
 * right for a right-hander, left for a left-hander), so the swing goes that way and the hands
 * moving the other way are the load, not a swing. Returns a function that puts back what was there.
 */
export function applyBattingRecognizer(hand: Side, rc: RecognizerConfig): () => void {
  const saved = rc.swing.forward;
  rc.swing.forward = sideSign(hand) > 0 ? 1 : -1;
  return () => {
    rc.swing.forward = saved;
  };
}
