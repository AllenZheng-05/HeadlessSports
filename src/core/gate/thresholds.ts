import type { GateThresholds } from './types';

/**
 * Gate thresholds. The tracker must manage 25 back-to-back inferences per second (the camera
 * delivers 30 fps, so that sustains about 25 Hz) while the renderer holds 50 fps on the same GPU.
 * To be tuned on real hardware.
 */
export const gateThresholds: GateThresholds = {
  minTrackingHz: 25,
  minRenderFps: 50,
  minViewportWidth: 900,
  minViewportHeight: 540,
  benchmarkMs: 2000,
  warmupInferences: 5,
};
