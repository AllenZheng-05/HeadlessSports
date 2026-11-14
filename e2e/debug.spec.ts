import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ScriptPlayer } from '../src/tracking/synthetic/script';
import type { Script } from '../src/tracking/synthetic/script';
import { getScript } from '../src/tracking/synthetic/scripts';

interface DebugState {
  tracking: boolean;
  hasPose: boolean;
  hands: { left: { present: boolean }; right: { present: boolean } };
}

interface DebugHook {
  ready: boolean;
  error: string | null;
  frames: number;
  posedFrames: number;
  renderFrames: number;
  fistChanges: number;
  backend: string;
  sourceKind: string;
  sourceFinished: boolean;
  state: DebugState;
  shoulderHeight: number;
  mitt(side: 'left' | 'right'): [number, number, number];
  recordFor(ms: number): Promise<number>;
  replayLast(): Promise<void>;
}

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

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

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/debug.html${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __debug?: DebugHook }).__debug?.ready === true,
    undefined,
    { timeout: 45000 },
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true });
}

function snap(page: Page): Promise<DebugHook> {
  return page.evaluate(() => {
    const d = (window as unknown as { __debug: DebugHook }).__debug;
    return {
      ready: d.ready,
      error: d.error,
      frames: d.frames,
      posedFrames: d.posedFrames,
      renderFrames: d.renderFrames,
      fistChanges: d.fistChanges,
      backend: d.backend,
      sourceKind: d.sourceKind,
      sourceFinished: d.sourceFinished,
      state: {
        tracking: d.state.tracking,
        hasPose: d.state.hasPose,
        hands: {
          left: { present: d.state.hands.left.present },
          right: { present: d.state.hands.right.present },
        },
      },
      shoulderHeight: d.shoulderHeight,
    } as DebugHook;
  });
}

async function waitFrames(page: Page, n: number, timeout = 30000): Promise<void> {
  await page.waitForFunction(
    (count) => (window as unknown as { __debug: DebugHook }).__debug.frames > count,
    n,
    { timeout },
  );
}

test('synthetic wave: tracking, fists and a raised right mitt', async ({ page }) => {
  const problems = watch(page);
  await open(page, '?source=synthetic&script=wave');
  await waitFrames(page, 90);

  let rightUp = false;
  let leftDownWhileUp = false;
  let trackingWhileUp = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const [r, l, shoulder, finished, tracking] = await page.evaluate(() => {
      const d = (window as unknown as { __debug: DebugHook }).__debug;
      return [
        d.mitt('right')[1],
        d.mitt('left')[1],
        d.shoulderHeight,
        d.sourceFinished,
        d.state.tracking,
      ] as const;
    });
    if (r > shoulder) {
      rightUp = true;
      if (tracking) trackingWhileUp = true;
      if (l < shoulder) leftDownWhileUp = true;
    }
    if (finished && rightUp) break;
    await page.waitForTimeout(60);
  }
  await page.waitForFunction(
    () => (window as unknown as { __debug: DebugHook }).__debug.fistChanges >= 2,
    undefined,
    { timeout: 30000 },
  );

  const s = await snap(page);
  console.info(
    `[wave] frames=${s.frames} posed=${s.posedFrames} render=${s.renderFrames} fists=${s.fistChanges} backend=${s.backend}`,
  );
  expect(s.error).toBeNull();
  expect(trackingWhileUp).toBe(true);
  expect(s.posedFrames).toBeGreaterThan(60);
  expect(s.renderFrames).toBeGreaterThan(10);
  expect(s.fistChanges).toBeGreaterThanOrEqual(2);
  expect(rightUp).toBe(true);
  expect(leftDownWhileUp).toBe(true);
  expect(problems).toEqual([]);

  // Screenshot in slow motion so the arm is still raised when the picture is taken.
  await open(page, '?source=synthetic&script=wave&timeScale=0.15');
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __debug: DebugHook }).__debug;
      return d.mitt('right')[1] > d.shoulderHeight + 0.1;
    },
    undefined,
    { timeout: 30000 },
  );
  await shot(page, 'debug-synthetic-wave.png');
  expect(problems).toEqual([]);
});

test('synthetic hands: hands only, no pose', async ({ page }) => {
  const problems = watch(page);
  await open(page, '?source=synthetic&script=hands&needs=hands');
  await waitFrames(page, 30);

  let both = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const s = await snap(page);
    if (s.state.hands.left.present && s.state.hands.right.present) {
      both = true;
      break;
    }
    await page.waitForTimeout(80);
  }
  await shot(page, 'debug-synthetic-hands.png');
  await page.waitForFunction(
    () => (window as unknown as { __debug: DebugHook }).__debug.fistChanges >= 2,
    undefined,
    { timeout: 30000 },
  );

  const s = await snap(page);
  expect(s.error).toBeNull();
  expect(s.state.hasPose).toBe(false);
  expect(s.posedFrames).toBe(0);
  expect(both).toBe(true);
  expect(s.fistChanges).toBeGreaterThanOrEqual(2);
  expect(problems).toEqual([]);
});

test('webgl renderer reports webgl2 and renders', async ({ page }) => {
  const problems = watch(page);
  await open(page, '?source=synthetic&script=wave&renderer=webgl');
  await waitFrames(page, 30);
  await page.waitForFunction(
    () => (window as unknown as { __debug: DebugHook }).__debug.renderFrames > 10,
  );
  const s = await snap(page);
  expect(s.error).toBeNull();
  expect(s.backend).toBe('webgl2');
  expect(problems).toEqual([]);
});

test('camera: fake device delivers frames', async ({ page }) => {
  const problems = watch(page);
  await open(page, '');
  await page.waitForFunction(
    () => (window as unknown as { __debug: DebugHook }).__debug.frames >= 10,
    undefined,
    { timeout: 45000 },
  );
  await shot(page, 'debug-camera.png');
  const s = await snap(page);
  expect(s.error).toBeNull();
  expect(s.sourceKind).toBe('camera');
  expect(s.frames).toBeGreaterThanOrEqual(10);
  expect(problems).toEqual([]);
});

test('record then replay', async ({ page }) => {
  const problems = watch(page);
  await open(page, '?source=synthetic&script=wave');
  await waitFrames(page, 10);
  const count = await page.evaluate(() =>
    (window as unknown as { __debug: DebugHook }).__debug.recordFor(1500),
  );
  expect(count).toBeGreaterThan(30);

  await page.evaluate(() => (window as unknown as { __debug: DebugHook }).__debug.replayLast());
  const before = (await snap(page)).frames;
  await page.waitForFunction(
    (n) => (window as unknown as { __debug: DebugHook }).__debug.frames > n + 20,
    before,
    { timeout: 30000 },
  );
  const s = await snap(page);
  expect(s.sourceKind).toBe('replay');
  expect(s.error).toBeNull();
  expect(problems).toEqual([]);
});

test('timeScale=4 finishes the script early', async ({ page }) => {
  const problems = watch(page);
  await open(page, '?source=synthetic&script=wave&timeScale=4');
  const started = Date.now();
  await page.waitForFunction(
    () => (window as unknown as { __debug: DebugHook }).__debug.sourceFinished,
    undefined,
    { timeout: 30000 },
  );
  const elapsed = Date.now() - started;
  const scriptMs = new ScriptPlayer(getScript('wave') as Script).durationMs;
  console.info(`[timeScale=4] finished ${elapsed} ms after ready; script lasts ${scriptMs} ms`);
  const s = await snap(page);
  expect(s.error).toBeNull();
  expect(s.frames).toBeGreaterThan(20);
  expect(elapsed).toBeLessThan(scriptMs * 0.6);
  expect(problems).toEqual([]);
});
