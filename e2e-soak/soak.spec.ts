import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

const RESULTS = 'e2e-soak/results';
mkdirSync(RESULTS, { recursive: true });

const MINUTES = positive(process.env.SOAK_MINUTES, 4);
const TIMESCALE = positive(process.env.SOAK_TIMESCALE, 2);
const MAX_HEAP_MB_PER_MIN = positive(process.env.SOAK_MAX_HEAP_MB_PER_MIN, 8);
const SAMPLE_EVERY_MS = 10000;
const ROUND_TIMEOUT_MS = 180000;
const SPORTS = ['climbing', 'bowling', 'batting', 'archery', 'javelin'] as const;

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---- Samples ----

interface Sample {
  /** Seconds since the scenario started. */
  t: number;
  kind: 'tick' | 'round';
  round: number;
  phase: string;
  /** performance.memory, megabytes (after a forced GC when available). */
  usedJsMB: number | null;
  totalJsMB: number | null;
  /** CDP Performance.getMetrics. */
  cdpHeapUsedMB: number | null;
  nodes: number | null;
  listeners: number | null;
  documents: number | null;
  layoutCount: number | null;
  /** CDP Memory.getDOMCounters (null where it does not work). */
  domNodes: number | null;
  domListeners: number | null;
  frames: number | null;
  drawCalls: number | null;
  /** three.js renderer.info.memory: not exposed by the app, always null. */
  geometries: number | null;
  textures: number | null;
  extra: Record<string, number | string | boolean | null>;
}

type NumKey =
  | 'usedJsMB'
  | 'totalJsMB'
  | 'cdpHeapUsedMB'
  | 'nodes'
  | 'listeners'
  | 'documents'
  | 'layoutCount'
  | 'domNodes'
  | 'domListeners'
  | 'frames'
  | 'drawCalls';

const REPORTED: NumKey[] = [
  'usedJsMB',
  'totalJsMB',
  'cdpHeapUsedMB',
  'nodes',
  'listeners',
  'documents',
  'domNodes',
  'domListeners',
  'drawCalls',
];

interface Page0 {
  used: number | null;
  total: number | null;
  frames: number | null;
  drawCalls: number | null;
  phase: string;
  extra: Record<string, number | string | boolean | null>;
}

interface Scenario {
  name: string;
  minutes: number;
  samples: Sample[];
  rounds: number;
  problems: string[];
  notes: string[];
  startedAt: string;
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

/** Reads the page side of one sample. Real functions only: the production CSP forbids eval. */
function readPage(page: Page): Promise<Page0> {
  return page.evaluate(() => {
    interface Mem {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
    }
    const w = window as unknown as {
      gc?: () => void;
      __game?: { phase: string; frames: number; drawCalls: number; inputKind: string | null };
      __debug?: {
        frames: number;
        posedFrames: number;
        renderFrames: number;
        backend: string;
        sourceKind: string;
        stats: {
          inferenceMs: number;
          trackingHz: number;
          droppedFrames: number;
          delegate: string;
          inWorker: boolean;
        };
      };
    };
    w.gc?.();
    const mem = (performance as unknown as { memory?: Mem }).memory;
    const extra: Record<string, number | string | boolean | null> = {};
    let phase = 'none';
    let frames: number | null = null;
    let drawCalls: number | null = null;
    if (w.__game) {
      phase = w.__game.phase;
      frames = w.__game.frames;
      drawCalls = w.__game.drawCalls;
    }
    if (w.__debug) {
      const d = w.__debug;
      phase = 'debug';
      frames = d.renderFrames;
      extra.trackerFrames = d.frames;
      extra.posedFrames = d.posedFrames;
      extra.backend = d.backend;
      extra.sourceKind = d.sourceKind;
      extra.inferenceMs = d.stats.inferenceMs;
      extra.trackingHz = d.stats.trackingHz;
      extra.droppedFrames = d.stats.droppedFrames;
      extra.delegate = d.stats.delegate;
      extra.inWorker = d.stats.inWorker;
    }
    return {
      used: mem ? mem.usedJSHeapSize : null,
      total: mem ? mem.totalJSHeapSize : null,
      frames,
      drawCalls,
      phase,
      extra,
    };
  });
}

const MB = 1024 * 1024;

class Recorder {
  readonly samples: Sample[] = [];
  rounds = 0;
  private readonly t0 = Date.now();
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cdp: CDPSession | null = null;
  private domCountersWork = true;

  constructor(private readonly page: Page) {}

  async init(): Promise<void> {
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send('Performance.enable');
  }

  elapsedMs(): number {
    return Date.now() - this.t0;
  }

  startTicks(): void {
    this.timer = setInterval(() => {
      void this.sample('tick');
    }, SAMPLE_EVERY_MS);
  }

  /** Stops the timer and waits for any sample in flight. */
  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.chain;
  }

  /** Serialised so ticks and round boundaries never overlap. */
  sample(kind: 'tick' | 'round'): Promise<void> {
    this.chain = this.chain.then(() => this.take(kind)).catch(() => undefined);
    return this.chain;
  }

  private async take(kind: 'tick' | 'round'): Promise<void> {
    const cdp = this.cdp;
    if (cdp === null || this.page.isClosed()) return;
    const p = await readPage(this.page);
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = new Map(metrics.map((x) => [x.name, x.value]));
    let dom: { nodes: number; jsEventListeners: number } | null = null;
    if (this.domCountersWork) {
      try {
        dom = await cdp.send('Memory.getDOMCounters');
      } catch {
        this.domCountersWork = false;
      }
    }
    const val = (k: string): number | null => m.get(k) ?? null;
    const heap = val('JSHeapUsedSize');
    this.samples.push({
      t: (Date.now() - this.t0) / 1000,
      kind,
      round: this.rounds,
      phase: p.phase,
      usedJsMB: p.used === null ? null : p.used / MB,
      totalJsMB: p.total === null ? null : p.total / MB,
      cdpHeapUsedMB: heap === null ? null : heap / MB,
      nodes: val('Nodes'),
      listeners: val('JSEventListeners'),
      documents: val('Documents'),
      layoutCount: val('LayoutCount'),
      domNodes: dom ? dom.nodes : null,
      domListeners: dom ? dom.jsEventListeners : null,
      frames: p.frames,
      drawCalls: p.drawCalls,
      geometries: null,
      textures: null,
      extra: p.extra,
    });
  }
}

// ---- Statistics ----

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return Number.NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function series(samples: Sample[], key: NumKey): number[] {
  return samples.map((s) => s[key]).filter((v): v is number => v !== null);
}

/** Least-squares slope of `key` against minutes, after discarding the first 20% as warm-up. */
function slopePerMinute(samples: Sample[], key: NumKey): number {
  const kept = samples.slice(Math.floor(samples.length * 0.2));
  const pts = kept
    .map((s) => ({ x: s.t / 60, y: s[key] }))
    .filter((p): p is { x: number; y: number } => p.y !== null);
  const n = pts.length;
  if (n < 3) return Number.NaN;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? Number.NaN : num / den;
}

interface Growth {
  first: number;
  last: number;
  abs: number;
  pct: number;
  perRound: number;
}

function growth(samples: Sample[], key: NumKey, rounds: number): Growth | null {
  const n = samples.length;
  if (n < 4) return null;
  const q = Math.max(1, Math.floor(n / 4));
  const first = median(series(samples.slice(0, q), key));
  const last = median(series(samples.slice(n - q), key));
  if (Number.isNaN(first) || Number.isNaN(last)) return null;
  const abs = last - first;
  return {
    first,
    last,
    abs,
    pct: first === 0 ? 0 : (abs / first) * 100,
    perRound: rounds > 0 ? abs / rounds : Number.NaN,
  };
}

function f(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : 'n/a';
}

function summaryFor(s: Scenario): string {
  const lines: string[] = [];
  const durationMin = (s.samples.at(-1)?.t ?? 0) / 60;
  lines.push(`## ${s.name}`, '');
  lines.push(
    `Duration ${f(durationMin, 1)} min, ${s.samples.length} samples, ${s.rounds} rounds. ` +
      `JS heap slope after warm-up: ${f(slopePerMinute(s.samples, 'usedJsMB'))} MB/min ` +
      `(CDP heap ${f(slopePerMinute(s.samples, 'cdpHeapUsedMB'))} MB/min).`,
    '',
  );
  lines.push(
    '| Metric | First quartile | Last quartile | Growth | Growth % | Per round |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const key of REPORTED) {
    const g = growth(s.samples, key, s.rounds);
    if (g === null) continue;
    lines.push(
      `| ${key} | ${f(g.first)} | ${f(g.last)} | ${f(g.abs)} | ${f(g.pct, 1)}% | ${f(g.perRound, 3)} |`,
    );
  }
  lines.push('');
  const roundSamples = s.samples.filter((x) => x.kind === 'round');
  if (roundSamples.length > 0) {
    lines.push(
      'Round boundaries (MB heap / nodes / listeners / draw calls):',
      '',
      roundSamples
        .map(
          (r) =>
            `${r.round}: ${f(r.usedJsMB ?? Number.NaN, 1)} / ${r.nodes ?? '-'} / ${r.listeners ?? '-'} / ${r.drawCalls ?? '-'}`,
        )
        .join('; '),
      '',
    );
  }
  lines.push(
    'three.js geometries and textures: not available (the app does not expose the renderer).',
    '',
  );
  const last = s.samples.at(-1);
  if (last && Object.keys(last.extra).length > 0) {
    lines.push(`Last tracking sample: \`${JSON.stringify(last.extra)}\``, '');
  }
  for (const note of s.notes) lines.push(`Note: ${note}`, '');
  if (s.problems.length > 0) {
    lines.push('Problems:', '', ...s.problems.slice(0, 10).map((p) => `- ${p}`), '');
  }
  return lines.join('\n');
}

function writeResults(s: Scenario): void {
  writeFileSync(`${RESULTS}/${s.name}.json`, JSON.stringify(s, null, 1));
  const files = readdirSync(RESULTS)
    .filter((n) => n.endsWith('.json'))
    .sort();
  const parts = files.map((n) => summaryFor(JSON.parse(readFileSync(`${RESULTS}/${n}`, 'utf8'))));
  const head = `# Soak summary\n\nSettings of the last run: SOAK_MINUTES=${MINUTES}, SOAK_TIMESCALE=${TIMESCALE}.\n`;
  writeFileSync(`${RESULTS}/summary.md`, `${head}\n${parts.join('\n')}\n`);
}

// ---- Page helpers ----

async function waitPhase(page: Page, phase: string, timeout: number): Promise<void> {
  try {
    await page.waitForFunction(
      (p) => (window as unknown as { __game?: { phase: string } }).__game?.phase === p,
      phase,
      { timeout },
    );
  } catch (err) {
    const now = await page.evaluate(() => {
      const g = (window as unknown as { __game?: { phase: string; error: string | null } }).__game;
      return g ? `${g.phase} (error: ${g.error ?? 'none'})` : 'no __game';
    });
    throw new Error(`Never reached phase "${phase}"; stuck at ${now}.`, { cause: err });
  }
}

async function waitLeftResults(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __game: { phase: string } }).__game.phase !== 'results',
    undefined,
    { timeout: 30000 },
  );
}

function sportUrl(id: string, seed: number): string {
  return `/?sport=${id}&source=synthetic&skipGate=1&short=1&timeScale=${TIMESCALE}&seed=${seed}`;
}

// ---- Assertions shared by the sport scenarios ----

function assertRoundMetrics(s: Scenario): void {
  expect(s.rounds, 'rounds completed').toBeGreaterThanOrEqual(2);
  const rs = s.samples.filter((x) => x.kind === 'round');
  if (rs.length >= 2) {
    const second = rs[1]!;
    const last = rs[rs.length - 1]!;
    for (const key of ['nodes', 'listeners'] as const) {
      const a = second[key];
      const b = last[key];
      if (a !== null && b !== null) {
        expect(b, `${key} round ${second.round} -> ${last.round}`).toBeLessThanOrEqual(a * 1.1 + 5);
      }
    }
    // Same point in the round (the results screen): the draw calls must not climb.
    const dcA = second.drawCalls;
    const dcB = last.drawCalls;
    if (dcA !== null && dcB !== null) {
      expect(dcB, 'draw calls at the results screen').toBeLessThanOrEqual(dcA * 1.25 + 5);
    }
  }
}

function assertCommon(s: Scenario): void {
  expect(s.problems, 'console and page errors').toEqual([]);
  const slope = slopePerMinute(s.samples, 'usedJsMB');
  if (Number.isFinite(slope)) {
    expect(slope, 'JS heap slope MB/min after warm-up').toBeLessThanOrEqual(MAX_HEAP_MB_PER_MIN);
  }
}

async function runScenario(
  page: Page,
  name: string,
  minutes: number,
  body: (rec: Recorder, scenario: Scenario) => Promise<void>,
): Promise<Scenario> {
  const problems = watch(page);
  const rec = new Recorder(page);
  await rec.init();
  const scenario: Scenario = {
    name,
    minutes,
    samples: rec.samples,
    rounds: 0,
    problems,
    notes: [],
    startedAt: new Date().toISOString(),
  };
  try {
    rec.startTicks();
    await body(rec, scenario);
  } catch (err) {
    scenario.notes.push(`aborted: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    await rec.stop();
    scenario.rounds = rec.rounds;
    writeResults(scenario);
  }
  return scenario;
}

// ---- Scenarios ----

test.describe('memory soak', () => {
  SPORTS.forEach((id, index) => {
    test(`${id} on repeat`, async ({ page }) => {
      // Known defect: every round leaks about 1.4 MB of ArrayBuffer backing stores (archery is the
      // worst; see docs/SOAK.md). performance.memory counts them, so the heap slope trips the limit.
      test.fail(id === 'archery', 'Per-round ArrayBuffer retention, see docs/SOAK.md');
      const deadline = MINUTES * 60000;
      const scenario = await runScenario(page, `sport-${id}`, MINUTES, async (rec) => {
        await page.goto(sportUrl(id, index + 1));
        for (;;) {
          await waitPhase(page, 'results', ROUND_TIMEOUT_MS);
          rec.rounds++;
          await rec.sample('round');
          if (rec.elapsedMs() >= deadline) break;
          await page.getByRole('button', { name: 'Play again' }).click();
          await waitLeftResults(page);
        }
      });
      assertRoundMetrics(scenario);
      assertCommon(scenario);
    });
  });

  test('rotation through all sports via the menu', async ({ page }) => {
    test.setTimeout(MINUTES * 2 * 60000 + 180000);
    const minRounds = SPORTS.length * 2;
    const deadline = MINUTES * 60000;
    const hardStop = MINUTES * 2 * 60000;
    const scenario = await runScenario(page, 'rotation', MINUTES, async (rec, sc) => {
      sc.notes.push(
        'Rotation used the in-page menu path (Menu button, sport card, Start on the how-to), one page lifetime.',
      );
      await page.goto(sportUrl(SPORTS[0], 7));
      for (;;) {
        await waitPhase(page, 'results', ROUND_TIMEOUT_MS);
        rec.rounds++;
        await rec.sample('round');
        const done =
          (rec.elapsedMs() >= deadline && rec.rounds >= minRounds) || rec.elapsedMs() >= hardStop;
        if (done) break;
        const next = SPORTS[rec.rounds % SPORTS.length]!;
        await page.getByRole('button', { name: 'Menu' }).click();
        await waitPhase(page, 'menu', 30000);
        await page.locator(`.sport-card[data-sport="${next}"]`).click();
        await waitPhase(page, 'howto', 30000);
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await waitLeftResults(page);
      }
    });
    expect(scenario.rounds, 'two full cycles').toBeGreaterThanOrEqual(minRounds);
    assertRoundMetrics(scenario);
    assertCommon(scenario);
  });

  test('idle lobby', async ({ page }) => {
    const scenario = await runScenario(page, 'lobby', MINUTES, async (rec) => {
      await page.goto('/?skipGate=1&input=debug');
      await waitPhase(page, 'title', 60000);
      await page.getByRole('button', { name: /start/i }).click();
      await waitPhase(page, 'menu', 30000);
      await page.waitForTimeout(MINUTES * 60000);
      await rec.sample('tick');
    });
    const frames = series(scenario.samples, 'frames');
    expect(frames.at(-1) ?? 0, 'lobby kept rendering').toBeGreaterThan(frames[0] ?? 0);
    assertCommon(scenario);
  });

  test('tracking pipeline on the debug page', async ({ page }) => {
    const scenario = await runScenario(page, 'tracking', MINUTES, async (rec, sc) => {
      sc.notes.push(
        'Only the page (main thread) heap is sampled; the tracking worker has its own heap that this harness cannot read. The fake camera shows no person, so hand crops rarely detect.',
      );
      await page.goto('/debug.html');
      await page.waitForFunction(
        () => (window as unknown as { __debug?: { ready: boolean } }).__debug?.ready === true,
        undefined,
        { timeout: 90000 },
      );
      await page.waitForTimeout(MINUTES * 60000);
      await rec.sample('tick');
    });
    const frames = series(scenario.samples, 'frames');
    expect(frames.at(-1) ?? 0, 'debug page kept rendering').toBeGreaterThan(frames[0] ?? 0);
    assertCommon(scenario);
  });
});
