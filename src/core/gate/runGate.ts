import type { RendererHandle } from '../../render/renderer';
import { benchmarkTracker } from '../../tracking/camera/benchmark';
import { detectCapabilities } from './capabilities';
import {
  capabilityFailures,
  isMarginal,
  measurementFailures,
  trackingCapacityHz,
} from './evaluate';
import { createRenderBenchmark } from './renderBenchmark';
import { gateThresholds } from './thresholds';
import type {
  GateCapabilities,
  GateFailure,
  GateMeasurements,
  GateReport,
  GateThresholds,
} from './types';

export interface RunGateOptions {
  renderer: RendererHandle;
  poseModel: 'lite' | 'full';
  skip: boolean;
  mainThread?: boolean;
  thresholds?: GateThresholds;
  onProgress?: (fraction: number, label: string) => void;
}

/** Camera rate cap for the capacity figure. */
const CAMERA_HZ = 30;

function makeReport(
  caps: GateCapabilities,
  thresholds: GateThresholds,
  fields: Partial<GateReport>,
): GateReport {
  return {
    passed: false,
    skipped: false,
    failures: [],
    capabilities: caps,
    measurements: null,
    thresholds,
    error: null,
    ...fields,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never rejects: failures are reported in the GateReport. */
export async function runGate(options: RunGateOptions): Promise<GateReport> {
  const thresholds = options.thresholds ?? gateThresholds;
  const progress = options.onProgress ?? ((): void => undefined);
  let caps: GateCapabilities;
  try {
    caps = detectCapabilities();
  } catch (err) {
    const empty: GateCapabilities = {
      webgl2: false,
      cameraApi: false,
      workers: false,
      touchPrimary: false,
      viewportWidth: 0,
      viewportHeight: 0,
    };
    return makeReport(empty, thresholds, { failures: ['benchmark-error'], error: errText(err) });
  }

  if (options.skip) return makeReport(caps, thresholds, { passed: true, skipped: true });

  const capFailures = capabilityFailures(caps, thresholds);
  if (capFailures.length > 0) return makeReport(caps, thresholds, { failures: capFailures });

  let ticker = 0;
  let render: ReturnType<typeof createRenderBenchmark> | null = null;
  try {
    render = createRenderBenchmark(options.renderer);
    const rb = render;
    progress(0.05, 'Loading the tracker');
    rb.start();
    let measureStartedAt = 0;
    const tracker = await benchmarkTracker({
      poseModel: options.poseModel,
      warmupInferences: thresholds.warmupInferences,
      durationMs: thresholds.benchmarkMs,
      forceMainThread: options.mainThread,
      onWarmupStart: () => progress(0.4, 'Warming up'),
      onMeasureStart: () => {
        // Both measurements cover the same window.
        rb.markMeasureStart(thresholds.discardRenderFrames ?? 0);
        measureStartedAt = performance.now();
        progress(0.5, 'Measuring');
        ticker = window.setInterval(() => {
          const f = Math.min(1, (performance.now() - measureStartedAt) / thresholds.benchmarkMs);
          progress(0.5 + 0.5 * f, 'Measuring');
        }, 100);
      },
    });
    const rendered = rb.stop();
    const renderFps = rendered.frames > 0 && rendered.frameMs > 0 ? 1000 / rendered.frameMs : 0;
    const measurements: GateMeasurements = {
      inferenceMs: tracker.inferenceMs,
      trackingHz: trackingCapacityHz(tracker.inferenceMs, CAMERA_HZ),
      renderFrameMs: rendered.frameMs,
      renderFps,
      rendererBackend: options.renderer.backend,
      trackerDelegate: tracker.delegate,
      trackerInWorker: tracker.inWorker,
    };
    const failures: GateFailure[] = measurementFailures(measurements, thresholds);
    progress(1, 'Done');
    const passed = failures.length === 0;
    return makeReport(caps, thresholds, {
      passed,
      marginal: passed && isMarginal(measurements, thresholds),
      failures,
      measurements,
    });
  } catch (err) {
    return makeReport(caps, thresholds, { failures: ['benchmark-error'], error: errText(err) });
  } finally {
    if (ticker) window.clearInterval(ticker);
    render?.dispose();
  }
}
