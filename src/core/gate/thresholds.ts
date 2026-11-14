import type { GateThresholds } from './types';

/**
 * Gate thresholds. Deliberately permissive: the gate exists to stop machines that genuinely
 * cannot play (software rendering, single-digit tracking), not to pick good ones.
 *
 * - Tracking is judged by capacity: median inference time must be under 1000 / minTrackingHz ms
 *   (66 ms at 15 Hz). Many webcams only deliver 15 to 30 fps, so the camera rate is never held
 *   against the machine.
 * - Rendering is judged by the median frame time, so a vsync-capped display with occasional dips
 *   (or a 30 Hz battery-saver cap) is fine.
 * - Between the minimum and the marginal values the gate passes but flags the report `marginal`.
 */
export const gateThresholds: GateThresholds = {
  minTrackingHz: 15,
  minRenderFps: 27,
  marginalTrackingHz: 20,
  marginalRenderFps: 40,
  discardRenderFrames: 15,
  minViewportWidth: 900,
  minViewportHeight: 540,
  benchmarkMs: 3000,
  warmupInferences: 10,
};
