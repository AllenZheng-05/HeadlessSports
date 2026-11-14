/**
 * Contract for the device gate. Types only.
 *
 * The gate runs once at load, before the title screen. It is a warning, not a block: a device
 * that fails the checks is told the game may not run well and may still try. Only a missing
 * capability the game cannot start without (WebGL 2, workers) is terminal. There are no quality
 * tiers: every device gets the one fixed configuration.
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
  /**
   * Optional "marginal" band: a device that clears the minimums but is below these still passes,
   * and the report is flagged `marginal`. Optional so older literals keep compiling.
   */
  marginalTrackingHz?: number;
  marginalRenderFps?: number;
  /** Render frames discarded at the start of the measured window (shader compile, first present). */
  discardRenderFrames?: number;
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
  /**
   * Tracking capacity: 1000 / median inference ms, capped at 30 (the camera rate). Measures what
   * the machine could do, not what a slow camera delivers.
   */
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
  /** Passed, but below the comfortable band: the game runs, performance may be rough. */
  marginal?: boolean;
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
