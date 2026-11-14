/**
 * Contract for the device gate. Types only.
 *
 * The gate runs once at load, before the title screen. It is a hard gate: a device either
 * passes and gets the one fixed quality configuration, or sees the "needs a more powerful
 * computer" screen. There are no quality tiers.
 */

export type GateFailure =
  | 'mobile'
  | 'small-viewport'
  | 'no-webgl2'
  | 'no-camera-api'
  | 'no-workers'
  | 'slow-tracking'
  | 'slow-rendering'
  | 'benchmark-error';

export interface GateThresholds {
  /** Tracking must sustain at least this many inferences per second during the benchmark. */
  minTrackingHz: number;
  /** Rendering must hold at least this many frames per second while tracking runs. */
  minRenderFps: number;
  minViewportWidth: number;
  minViewportHeight: number;
  /** Length of the measured part of the benchmark, ms. */
  benchmarkMs: number;
  /** Inferences discarded before measuring. */
  warmupInferences: number;
}

export interface GateCapabilities {
  webgl2: boolean;
  cameraApi: boolean;
  workers: boolean;
  /** Primary pointer is coarse and there is no hover: a phone or tablet. */
  touchPrimary: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface GateMeasurements {
  /** Median inference time during the measured window, ms. */
  inferenceMs: number;
  /** Inferences per second the tracker sustained back to back, capped at 30 for the verdict. */
  trackingHz: number;
  /** Median render frame time while tracking ran, ms. */
  renderFrameMs: number;
  renderFps: number;
  rendererBackend: 'webgpu' | 'webgl2';
  trackerDelegate: 'GPU' | 'CPU' | 'none';
  trackerInWorker: boolean;
}

export interface GateReport {
  passed: boolean;
  /** True when ?skipGate=1 bypassed the checks. */
  skipped: boolean;
  failures: GateFailure[];
  capabilities: GateCapabilities;
  /** Null when the benchmark did not run (capability failure, skip, or error). */
  measurements: GateMeasurements | null;
  thresholds: GateThresholds;
  /** Set when the benchmark threw. */
  error: string | null;
}
