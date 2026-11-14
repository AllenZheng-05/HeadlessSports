import { expect, test } from '@playwright/test';

interface Snapshot {
  frames: number;
  posed: number;
  handsSeen: number;
  error: string | null;
  stats: {
    delegate: string;
    inWorker: boolean;
    inferenceMs: number;
    trackingHz: number;
    latencyMs: number;
    droppedFrames: number;
  };
}

const cases = [
  { name: 'pose', query: 'mode=pose', inWorker: true },
  { name: 'crops', query: 'mode=crops', inWorker: true },
  { name: 'hands', query: 'mode=hands', inWorker: true },
  { name: 'pose on main thread', query: 'mode=pose&main=1', inWorker: false },
];

for (const c of cases) {
  test(`tracking pipeline runs: ${c.name}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
      else if (msg.type() === 'warning') console.info(`[${c.name}] warn: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      problems.push(`pageerror: ${err.message}`);
    });

    await page.goto(`/tracking-harness.html?${c.query}`);
    await page.waitForFunction(
      () => {
        const t = (window as unknown as { __tracking?: { frames: number; error: string | null } })
          .__tracking;
        return !!t && (t.frames >= 20 || t.error !== null);
      },
      undefined,
      { timeout: 45000 },
    );

    const snap = await page.evaluate(
      () => (window as unknown as { __tracking: Snapshot }).__tracking,
    );
    console.info(
      `[${c.name}] frames=${snap.frames} delegate=${snap.stats.delegate} ` +
        `inWorker=${snap.stats.inWorker} inferenceMs=${snap.stats.inferenceMs.toFixed(1)} ` +
        `hz=${snap.stats.trackingHz} dropped=${snap.stats.droppedFrames}`,
    );

    expect(snap.error).toBeNull();
    expect(snap.frames).toBeGreaterThanOrEqual(20);
    expect(snap.stats.inWorker).toBe(c.inWorker);
    expect(problems).toEqual([]);
  });
}
