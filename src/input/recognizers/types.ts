import type { GameEvent, InputState } from '../types';

export type Emit = (event: GameEvent) => void;

/**
 * A small state machine fed once per TRACKING frame, after FrameProcessor.process has updated
 * `state`. Durations use `state.t`, never the wall clock. No allocation per frame.
 */
export interface Recognizer {
  readonly name: string;
  /** Default true: skipped (and reset) while the frame has no usable pose. */
  readonly needsPose?: boolean;
  update(state: InputState, emit: Emit): void;
  reset(): void;
  /** Optional: told whether a calibration is set (SquatJump then trusts `state.rise`). */
  setCalibrated?(calibrated: boolean): void;
}
