import type {
  GateCapabilities,
  GateFailure,
  GateMeasurements,
  GateReport,
  GateThresholds,
} from './types';

/** Failures without which the game cannot start at all. Everything else is only a warning. */
export const BLOCKING_FAILURES: readonly GateFailure[] = ['no-webgl2', 'no-workers'];

export type GateVerdict = 'ok' | 'warn' | 'blocked';

/**
 * What to do with a report: `ok` carries on silently (also for a merely marginal pass), `warn`
 * shows the "this device may struggle" screen and lets the player continue, `blocked` is the
 * terminal screen for a missing capability. With no camera wanted a missing camera API is fine.
 */
export function gateVerdict(report: GateReport, cameraWanted: boolean): GateVerdict {
  if (report.passed) return 'ok';
  if (report.failures.some((f) => BLOCKING_FAILURES.includes(f))) return 'blocked';
  if (!cameraWanted && report.failures.length === 1 && report.failures[0] === 'no-camera-api') {
    return 'ok';
  }
  return 'warn';
}

/** Capability failures in a fixed order. Empty means the device may proceed to the benchmark. */
export function capabilityFailures(c: GateCapabilities, t: GateThresholds): GateFailure[] {
  const out: GateFailure[] = [];
  if (c.touchPrimary) out.push('mobile');
  if (c.viewportWidth < t.minViewportWidth || c.viewportHeight < t.minViewportHeight) {
    out.push('small-viewport');
  }
  if (!c.webgl2) out.push('no-webgl2');
  if (!c.cameraApi) out.push('no-camera-api');
  if (!c.workers) out.push('no-workers');
  return out;
}

/**
 * Values exactly at a threshold pass. The minimums are low enough that vsync-capped displays
 * (30 Hz battery saver and up) clear them.
 */
export function measurementFailures(m: GateMeasurements, t: GateThresholds): GateFailure[] {
  const out: GateFailure[] = [];
  if (!(m.trackingHz >= t.minTrackingHz)) out.push('slow-tracking');
  if (!(m.renderFps >= t.minRenderFps)) out.push('slow-rendering');
  return out;
}

/** True when a passing device is below the comfortable band (see `marginalTrackingHz`). */
export function isMarginal(m: GateMeasurements, t: GateThresholds): boolean {
  if (t.marginalTrackingHz !== undefined && m.trackingHz < t.marginalTrackingHz) return true;
  if (t.marginalRenderFps !== undefined && m.renderFps < t.marginalRenderFps) return true;
  return false;
}

/** Tracking capacity in Hz from a median inference time, capped at the camera rate. */
export function trackingCapacityHz(inferenceMs: number, cameraHz: number): number {
  if (!(inferenceMs > 0)) return 0;
  return Math.min(cameraHz, 1000 / inferenceMs);
}

/** Median of the first `count` entries of `values` (mean of the middle two when even). 0 if empty. */
export function median(values: ArrayLike<number>, count: number): number {
  const n = Math.min(count, values.length);
  if (n <= 0) return 0;
  const copy = new Float64Array(n);
  for (let i = 0; i < n; i++) copy[i] = values[i] as number;
  copy.sort();
  const mid = n >> 1;
  return n % 2 === 1
    ? (copy[mid] as number)
    : ((copy[mid - 1] as number) + (copy[mid] as number)) / 2;
}
