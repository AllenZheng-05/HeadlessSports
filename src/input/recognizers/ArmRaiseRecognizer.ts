import type { InputState, Side } from '../types';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import type { Emit, Recognizer } from './types';

const SIDES: readonly Side[] = ['left', 'right'];

/**
 * Per arm: wrist above `raiseAbove` (sw above the shoulder) for `dwellMs` emits ArmRaised;
 * dropping below `lowerBelow` emits ArmLowered. Between the two thresholds nothing changes.
 */
export class ArmRaiseRecognizer implements Recognizer {
  readonly name = 'armRaise';
  private readonly config: RecognizerConfig;
  private readonly raised = [false, false];
  /** Time the wrist first went above the raise threshold, or -1. */
  private readonly aboveSince = [-1, -1];

  constructor(config: RecognizerConfig = recognizerConfig) {
    this.config = config;
  }

  update(state: InputState, emit: Emit): void {
    const c = this.config.armRaise;
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const y = state.arms[side].wristY;
      if (this.raised[i]) {
        if (y < c.lowerBelow) {
          this.raised[i] = false;
          this.aboveSince[i] = -1;
          emit({ type: 'ArmLowered', t: state.t, hand: side });
        }
        continue;
      }
      if (y > c.raiseAbove) {
        if (this.aboveSince[i] < 0) this.aboveSince[i] = state.t;
        if (state.t - this.aboveSince[i] >= c.dwellMs) {
          this.raised[i] = true;
          emit({ type: 'ArmRaised', t: state.t, hand: side, both: this.raised[1 - i] });
        }
      } else {
        this.aboveSince[i] = -1;
      }
    }
  }

  reset(): void {
    this.raised[0] = this.raised[1] = false;
    this.aboveSince[0] = this.aboveSince[1] = -1;
  }
}
