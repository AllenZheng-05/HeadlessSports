// Test support: play a synthetic script through the whole input stack with realistic noise and
// optional lost frames. Used by the side-on recognizer tests (and the sports' own).
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import type { Script } from '../../tracking/synthetic/script';
import type { FrameListener, LandmarkSource } from '../../tracking/types';
import { TrackedInput } from '../TrackedInput';
import { syntheticCalibration } from '../testing/runScript';
import type { GameEvent, InputState } from '../types';

/** Three times the synthetic default: closer to what a webcam and MediaPipe really jitter by. */
export const REAL_SIGMA = 0.0045;
const STEP_MS = 1000 / 60;
const NEEDS = { pose: true, handCrops: false, fullFrameHands: false };

export interface Played {
  events: GameEvent[];
  input: TrackedInput;
}

export interface PlayOptions {
  /** Frames whose script time (ms) falls in any of these ranges are lost. */
  drop?: [number, number][];
  calibrate?: boolean;
  extraMs?: number;
  sigma?: number;
  /** Called after every update step. */
  onFrame?: (state: InputState, tMs: number) => void;
  /** Called with the input before it starts (to change a recognizer config, say). */
  setup?: (input: TrackedInput) => void;
}

/** Play a script through source -> TrackedInput and collect every event. */
export function play(script: Script, seed: number, opts: PlayOptions = {}): Played {
  const inner = createSyntheticSource({
    script,
    noise: { seed, sigma: opts.sigma ?? REAL_SIGMA },
  });
  const drop = opts.drop ?? [];
  let t0 = -1;
  const source: LandmarkSource = {
    kind: 'synthetic',
    video: null,
    stats: inner.stats,
    start: (n) => inner.start(n),
    setNeeds: (n) => inner.setNeeds(n),
    pump: (n) => inner.pump(n),
    stop: () => inner.stop(),
    subscribe(listener: FrameListener) {
      return inner.subscribe((f) => {
        if (t0 < 0) t0 = f.t;
        const rel = f.t - t0;
        for (const [a, b] of drop) if (rel >= a && rel <= b) return;
        listener(f);
      });
    },
  };
  const input = new TrackedInput(source);
  if (opts.calibrate) input.setCalibration(syntheticCalibration());
  opts.setup?.(input);
  const events: GameEvent[] = [];
  input.onAny((e) => events.push(e));
  void input.start(NEEDS);
  let total = 0;
  for (const s of script.steps) total += s.dur;
  const steps = Math.ceil((total + (opts.extraMs ?? 600)) / STEP_MS);
  for (let i = 0; i <= steps; i++) {
    input.update(i * STEP_MS);
    opts.onFrame?.(input.state, i * STEP_MS);
  }
  input.stop();
  return { events, input };
}
