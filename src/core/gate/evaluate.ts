import type { GateCapabilities, GateFailure, GateMeasurements, GateThresholds } from './types';

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
 * Values exactly at a threshold pass. A display refresh capped below `minRenderFps` would fail
 * slow-rendering wrongly; that is exotic (50 Hz panels are rare) and deliberately not special-cased.
 */
export function measurementFailures(m: GateMeasurements, t: GateThresholds): GateFailure[] {
  const out: GateFailure[] = [];
  if (!(m.trackingHz >= t.minTrackingHz)) out.push('slow-tracking');
  if (!(m.renderFps >= t.minRenderFps)) out.push('slow-rendering');
  return out;
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
