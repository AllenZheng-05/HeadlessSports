import type { JavelinConfig } from './config';

export type SpeedCfg = Pick<
  JavelinConfig,
  | 'maxRunSpeed'
  | 'fullCadence'
  | 'fullAmplitude'
  | 'softCapKnee'
  | 'softCapMax'
  | 'minAmplitudeFactor'
  | 'accel'
  | 'decel'
  | 'cadenceHoldFactor'
  | 'cadenceFadeMs'
>;

/**
 * The step rate that drives the athlete: the last measured rate while the next step is not yet
 * overdue (`cadenceHoldFactor` intervals), then a linear fade to 0 over `cadenceFadeMs`.
 */
export function effectiveCadence(cadence: number, sinceStepMs: number, cfg: SpeedCfg): number {
  if (!(cadence > 0)) return 0;
  const hold = (1000 / cadence) * cfg.cadenceHoldFactor;
  if (sinceStepMs <= hold) return cadence;
  return cadence * Math.max(0, 1 - (sinceStepMs - hold) / cfg.cadenceFadeMs);
}

/** Identity up to `knee`, then approaches `max` asymptotically (slope 1 at the knee, so no kink). */
export function softCap(x: number, knee: number, max: number): number {
  if (x <= knee) return x < 0 ? 0 : x;
  const room = max - knee;
  return knee + room * (1 - Math.exp(-(x - knee) / room));
}

/** 0.75 .. 1 from the knee-lift amplitude. */
export function amplitudeFactor(amplitude: number, cfg: SpeedCfg): number {
  const k = amplitude <= 0 ? 0 : Math.min(1, amplitude / cfg.fullAmplitude);
  return cfg.minAmplitudeFactor + (1 - cfg.minAmplitudeFactor) * k;
}

/** Speed the athlete is heading for, m/s, from the recognizer's cadence. */
export function targetRunSpeed(stepsPerSecond: number, amplitude: number, cfg: SpeedCfg): number {
  if (!(stepsPerSecond > 0)) return 0;
  const x = softCap(stepsPerSecond / cfg.fullCadence, cfg.softCapKnee, cfg.softCapMax);
  return cfg.maxRunSpeed * x * amplitudeFactor(amplitude, cfg);
}

/** Ease `speed` toward `target` with separate acceleration and deceleration limits. */
export function approachSpeed(speed: number, target: number, dt: number, cfg: SpeedCfg): number {
  if (target > speed) return Math.min(target, speed + cfg.accel * dt);
  return Math.max(target, speed - cfg.decel * dt);
}
