import type { Emit, Recognizer } from '../recognizers/types';
import type { GameEvent, InputState } from '../types';
import { advance } from './frames';

/** Does nothing. */
export const noop = (): void => undefined;

/** An `Emit` that records every event. */
export function collector(): { events: GameEvent[]; emit: Emit } {
  const events: GameEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

/** Events of one type, narrowed. */
export function ofType<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/**
 * Drive a recognizer at `fps`: for each frame from `fromMs` (exclusive) to `toMs` (inclusive)
 * advance the clock, let `setup(t)` write the state, then call `update`.
 */
export function drive(
  rec: Recognizer,
  state: InputState,
  emit: Emit,
  fromMs: number,
  toMs: number,
  setup: (t: number) => void,
  fps = 30,
): void {
  const dt = 1000 / fps;
  for (let t = fromMs + dt; t <= toMs + 1e-6; t += dt) {
    advance(state, t);
    setup(t);
    rec.update(state, emit);
  }
}
