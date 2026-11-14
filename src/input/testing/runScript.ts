import type { TrackerNeeds } from '../../tracking/types';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { ScriptPlayer } from '../../tracking/synthetic/script';
import type { Script } from '../../tracking/synthetic/script';
import { TrackedInput } from '../TrackedInput';
import type { Calibration, GameEvent, InputState } from '../types';

export interface ScriptRun {
  events: GameEvent[];
  state: InputState;
  frames: number;
  durationMs: number;
}

export interface RunScriptOptions {
  needs?: TrackerNeeds;
  /** Noise seed. Default 1. */
  seed?: number;
  /** Pose noise sigma in normalised units. Default 0.0015 (the synthetic default); 0 turns noise off. */
  noise?: number;
  calibration?: Calibration | null;
  /** Keep running this long after the script ends. Default 0. */
  extraMs?: number;
  /** Called after every 1/60 s update step. */
  onFrame?: (state: InputState, tMs: number) => void;
}

const STEP_MS = 1000 / 60;

/**
 * Play a synthetic script through SyntheticSource -> TrackedInput offline (pumped in 1/60 s steps,
 * no timers) and collect every event. Time zero is the first frame, so event times equal script
 * times.
 */
export function runScript(script: Script, options: RunScriptOptions = {}): ScriptRun {
  const needs = options.needs ?? { pose: true, handCrops: true, fullFrameHands: false };
  const source = createSyntheticSource({
    script,
    noise: { seed: options.seed ?? 1, sigma: options.noise ?? 0.0015 },
  });
  const input = new TrackedInput(source);
  if (options.calibration) input.setCalibration(options.calibration);
  const events: GameEvent[] = [];
  input.onAny((e) => events.push(e));
  void input.start(needs);
  const durationMs = new ScriptPlayer(script).durationMs + (options.extraMs ?? 0);
  // Count steps instead of accumulating floats so the end time is exact.
  const steps = Math.ceil(durationMs / STEP_MS);
  for (let i = 0; i <= steps; i++) {
    const t = i * STEP_MS;
    input.update(t);
    options.onFrame?.(input.state, t);
  }
  input.stop();
  return { events, state: input.state, frames: input.frameCount, durationMs };
}

/** A plausible calibration for the synthetic player's default stance. */
export function syntheticCalibration(): Calibration {
  // Defaults (see tracking/synthetic/controls.ts and body.ts): shoulders at y 0.32 with width
  // 0.13, hips 1.45 shoulder widths below, arms 1.52 sw long.
  const shoulderWidth = 0.13;
  return {
    centreX: 0.5,
    centreY: 0.32,
    hipY: 0.32 + 1.45 * shoulderWidth,
    shoulderWidth,
    armLength: 1.52,
    handedness: 'right',
    seated: false,
  };
}
