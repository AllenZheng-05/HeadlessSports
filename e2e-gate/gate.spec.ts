import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface Report {
  passed: boolean;
  skipped: boolean;
  failures: string[];
  capabilities: { viewportWidth: number; viewportHeight: number };
  measurements: {
    inferenceMs: number;
    trackingHz: number;
    renderFrameMs: number;
    renderFps: number;
    rendererBackend: string;
    trackerDelegate: string;
    trackerInWorker: boolean;
  } | null;
  error: string | null;
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`pageerror: ${err.message}`);
  });
  return problems;
}

async function gateReport(page: Page, query: string): Promise<Report> {
  await page.goto(`/tracking-harness.html?mode=gate&${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __gate?: unknown }).__gate !== undefined,
    undefined,
    {
      timeout: 60000,
    },
  );
  const report = await page.evaluate(() => (window as unknown as { __gate: Report }).__gate);
  console.info(`[gate ${query}] ${JSON.stringify(report)}`);
  return report;
}

test('gate with permissive thresholds passes and measures', async ({ page }) => {
  const problems = watch(page);
  const report = await gateReport(page, 'minHz=0&minFps=0');
  expect(report.error).toBeNull();
  expect(report.measurements).not.toBeNull();
  const m = report.measurements!;
  for (const v of [m.inferenceMs, m.trackingHz, m.renderFrameMs, m.renderFps]) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  }
  expect(report.passed).toBe(true);
  expect(report.failures).toEqual([]);
  expect(problems).toEqual([]);
});

test('gate with default thresholds gives a well-formed verdict', async ({ page }) => {
  const report = await gateReport(page, 'ms=1500');
  expect(report.skipped).toBe(false);
  expect(report.measurements).not.toBeNull();
  if (report.passed) {
    expect(report.failures).toEqual([]);
  } else {
    // Software GL cannot hold the thresholds; that is the correct verdict.
    expect(report.failures.some((f) => f === 'slow-tracking' || f === 'slow-rendering')).toBe(true);
  }
});

test('a small viewport fails without measuring', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 400 });
  const report = await gateReport(page, 'minHz=0&minFps=0');
  expect(report.passed).toBe(false);
  expect(report.failures).toContain('small-viewport');
  expect(report.measurements).toBeNull();
});

test('the camera pipeline still works after the gate', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/tracking-harness.html?mode=gate&minHz=0&minFps=0&then=pose');
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __gate?: unknown;
        __tracking?: { frames: number; error: string | null };
      };
      return (
        w.__gate !== undefined &&
        !!w.__tracking &&
        (w.__tracking.frames >= 20 || w.__tracking.error !== null)
      );
    },
    undefined,
    { timeout: 80000 },
  );
  const snap = await page.evaluate(() => {
    const w = window as unknown as {
      __gate: Report;
      __tracking: { frames: number; posed: number; error: string | null };
    };
    return { gate: w.__gate, tracking: w.__tracking };
  });
  expect(snap.gate.passed).toBe(true);
  expect(snap.tracking.error).toBeNull();
  expect(snap.tracking.frames).toBeGreaterThanOrEqual(20);
  expect(problems).toEqual([]);
});
