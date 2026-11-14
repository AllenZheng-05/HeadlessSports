// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { RendererHandle } from '../../render/renderer';
import { runGate } from './runGate';
import { gateThresholds } from './thresholds';

describe('runGate', () => {
  it('returns immediately as skipped and passed', async () => {
    const report = await runGate({ renderer: {} as RendererHandle, poseModel: 'lite', skip: true });
    expect(report.skipped).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.measurements).toBeNull();
    expect(report.error).toBeNull();
    expect(report.thresholds).toEqual(gateThresholds);
    expect(report.capabilities.viewportWidth).toBe(window.innerWidth);
  });
});
