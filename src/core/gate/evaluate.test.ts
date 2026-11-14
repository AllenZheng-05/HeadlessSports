import { describe, expect, it } from 'vitest';
import {
  capabilityFailures,
  gateVerdict,
  isMarginal,
  measurementFailures,
  median,
  trackingCapacityHz,
} from './evaluate';
import { gateThresholds as t } from './thresholds';
import type { GateCapabilities, GateFailure, GateMeasurements, GateReport } from './types';

const goodCaps: GateCapabilities = {
  webgl2: true,
  cameraApi: true,
  workers: true,
  touchPrimary: false,
  viewportWidth: t.minViewportWidth,
  viewportHeight: t.minViewportHeight,
};

const goodMeasurements: GateMeasurements = {
  inferenceMs: 20,
  trackingHz: t.minTrackingHz,
  renderFrameMs: 1000 / t.minRenderFps,
  renderFps: t.minRenderFps,
  rendererBackend: 'webgl2',
  trackerDelegate: 'GPU',
  trackerInWorker: true,
};

describe('capabilityFailures', () => {
  it('passes at exactly the minimum viewport', () => {
    expect(capabilityFailures(goodCaps, t)).toEqual([]);
  });
  it('reports each failure', () => {
    expect(capabilityFailures({ ...goodCaps, touchPrimary: true }, t)).toEqual(['mobile']);
    expect(capabilityFailures({ ...goodCaps, webgl2: false }, t)).toEqual(['no-webgl2']);
    expect(capabilityFailures({ ...goodCaps, cameraApi: false }, t)).toEqual(['no-camera-api']);
    expect(capabilityFailures({ ...goodCaps, workers: false }, t)).toEqual(['no-workers']);
    expect(capabilityFailures({ ...goodCaps, viewportWidth: t.minViewportWidth - 1 }, t)).toEqual([
      'small-viewport',
    ]);
    expect(capabilityFailures({ ...goodCaps, viewportHeight: t.minViewportHeight - 1 }, t)).toEqual(
      ['small-viewport'],
    );
  });
  it('reports several at once', () => {
    const all = capabilityFailures(
      { ...goodCaps, touchPrimary: true, webgl2: false, workers: false, viewportWidth: 10 },
      t,
    );
    expect(all).toEqual(['mobile', 'small-viewport', 'no-webgl2', 'no-workers']);
  });
});

describe('measurementFailures', () => {
  it('passes at exactly the thresholds', () => {
    expect(measurementFailures(goodMeasurements, t)).toEqual([]);
  });
  it('fails slow tracking', () => {
    const m = { ...goodMeasurements, trackingHz: t.minTrackingHz - 0.01 };
    expect(measurementFailures(m, t)).toEqual(['slow-tracking']);
  });
  it('fails slow rendering', () => {
    const m = { ...goodMeasurements, renderFps: t.minRenderFps - 0.01 };
    expect(measurementFailures(m, t)).toEqual(['slow-rendering']);
  });
  it('fails both, and treats NaN as failing', () => {
    const m = { ...goodMeasurements, trackingHz: NaN, renderFps: 0 };
    expect(measurementFailures(m, t)).toEqual(['slow-tracking', 'slow-rendering']);
  });
});

describe('median', () => {
  it('handles odd, even and empty input', () => {
    expect(median([3, 1, 2], 3)).toBe(2);
    expect(median([4, 1, 3, 2], 4)).toBe(2.5);
    expect(median([], 0)).toBe(0);
  });
  it('only looks at the first count entries and does not mutate', () => {
    const v = new Float64Array([9, 1, 5, 100, 100]);
    expect(median(v, 3)).toBe(5);
    expect(Array.from(v)).toEqual([9, 1, 5, 100, 100]);
  });
});

function profile(inferenceMs: number, renderFps: number): GateMeasurements {
  return {
    ...goodMeasurements,
    inferenceMs,
    trackingHz: trackingCapacityHz(inferenceMs, 30),
    renderFrameMs: 1000 / renderFps,
    renderFps,
  };
}

describe('robust statistics', () => {
  it('median ignores outliers such as a warm-up spike or a hitch', () => {
    const frames = [16.7, 16.6, 16.7, 400, 16.8, 16.7, 16.6, 250, 16.7];
    expect(median(frames, frames.length)).toBeCloseTo(16.7, 1);
  });
  it('a 60 Hz display with dips still reads about 60 fps and passes', () => {
    const frames = new Float64Array(180).fill(16.67);
    for (let i = 0; i < 180; i += 10) frames[i] = 33.3; // one dropped frame in ten
    const fps = 1000 / median(frames, frames.length);
    expect(fps).toBeGreaterThan(59);
    expect(measurementFailures(profile(30, fps), t)).toEqual([]);
    expect(isMarginal(profile(30, fps), t)).toBe(false);
  });
  it('a 30 Hz capped display passes (marginal)', () => {
    const m = profile(30, 1000 / 33.4);
    expect(measurementFailures(m, t)).toEqual([]);
    expect(isMarginal(m, t)).toBe(true);
  });
  it('tracking capacity comes from inference time, so a slow camera does not cap it', () => {
    // A 15 fps camera would deliver 15 frames/s, but 25 ms per inference is 40 Hz of capacity.
    expect(trackingCapacityHz(25, 30)).toBe(30);
    expect(trackingCapacityHz(50, 30)).toBeCloseTo(20, 5);
    expect(trackingCapacityHz(0, 30)).toBe(0);
    expect(measurementFailures(profile(25, 60), t)).toEqual([]);
  });
});

describe('new thresholds', () => {
  it('are permissive', () => {
    expect(t.minTrackingHz).toBeLessThanOrEqual(15);
    expect(t.minRenderFps).toBeLessThanOrEqual(30);
  });
  it('integrated-GPU laptop profiles pass', () => {
    for (const [ms, fps] of [
      [25, 60],
      [35, 52],
      [45, 45],
    ] as const) {
      expect(measurementFailures(profile(ms, fps), t)).toEqual([]);
    }
    expect(isMarginal(profile(25, 60), t)).toBe(false);
    expect(isMarginal(profile(35, 52), t)).toBe(false);
  });
  it('software rendering fails', () => {
    const m = profile(180, 6);
    expect(measurementFailures(m, t)).toEqual(['slow-tracking', 'slow-rendering']);
    expect(measurementFailures(profile(150, 40), t)).toEqual(['slow-tracking']);
  });
  it('marginal band: passes but flagged', () => {
    const slowTrack = profile(60, 60); // about 16.7 Hz
    expect(measurementFailures(slowTrack, t)).toEqual([]);
    expect(isMarginal(slowTrack, t)).toBe(true);
    expect(isMarginal(profile(25, 35), t)).toBe(true);
    expect(isMarginal(profile(25, 60), t)).toBe(false);
    expect(isMarginal(profile(60, 60), { ...t, marginalTrackingHz: undefined })).toBe(false);
  });
});

describe('gateVerdict', () => {
  const report = (failures: GateFailure[]): GateReport => ({
    passed: failures.length === 0,
    skipped: false,
    failures,
    capabilities: goodCaps,
    measurements: null,
    thresholds: t,
    error: null,
  });

  it('passes silently, including a marginal pass', () => {
    expect(gateVerdict(report([]), true)).toBe('ok');
    expect(gateVerdict({ ...report([]), marginal: true }, true)).toBe('ok');
  });
  it('slow, small, touch and benchmark errors are warnings, not blocks', () => {
    for (const f of [
      'slow-tracking',
      'slow-rendering',
      'small-viewport',
      'mobile',
      'benchmark-error',
    ] as const) {
      expect(gateVerdict(report([f]), true)).toBe('warn');
    }
    expect(gateVerdict(report(['slow-tracking', 'slow-rendering']), true)).toBe('warn');
  });
  it('only a missing WebGL 2 or worker support blocks', () => {
    expect(gateVerdict(report(['no-webgl2']), true)).toBe('blocked');
    expect(gateVerdict(report(['no-workers']), true)).toBe('blocked');
    expect(gateVerdict(report(['slow-tracking', 'no-workers']), true)).toBe('blocked');
  });
  it('a missing camera API warns when a camera is wanted and is ignored when not', () => {
    expect(gateVerdict(report(['no-camera-api']), true)).toBe('warn');
    expect(gateVerdict(report(['no-camera-api']), false)).toBe('ok');
    expect(gateVerdict(report(['no-camera-api', 'slow-rendering']), false)).toBe('warn');
  });
});
