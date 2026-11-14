import { describe, expect, it } from 'vitest';
import { capabilityFailures, measurementFailures, median } from './evaluate';
import { gateThresholds as t } from './thresholds';
import type { GateCapabilities, GateMeasurements } from './types';

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
