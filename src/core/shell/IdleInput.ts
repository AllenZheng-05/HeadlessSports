import { createInputState } from '../../input/state';
import type {
  Calibration,
  GameEvent,
  GameEventOf,
  GameEventType,
  InputProvider,
  InputState,
  Unsubscribe,
} from '../../input/types';
import type { LandmarkSource, TrackerNeeds } from '../../tracking/types';

const noop = (): void => undefined;

/** Placeholder input before the player picks camera or mouse: tracks nothing, emits nothing. */
export class IdleInput implements InputProvider {
  readonly state: InputState = createInputState();
  readonly source: LandmarkSource | null = null;

  start(_needs: TrackerNeeds): Promise<void> {
    return Promise.resolve();
  }
  setNeeds(_needs: TrackerNeeds): Promise<void> {
    return Promise.resolve();
  }
  setCalibration(_calibration: Calibration | null): void {
    return;
  }
  update(_nowMs: number): void {
    return;
  }
  on<T extends GameEventType>(_type: T, _handler: (event: GameEventOf<T>) => void): Unsubscribe {
    return noop;
  }
  onAny(_handler: (event: GameEvent) => void): Unsubscribe {
    return noop;
  }
  stop(): void {
    return;
  }
}
