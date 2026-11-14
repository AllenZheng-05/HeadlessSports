import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

interface Watch {
  consoleErrors: string[];
  cspConsole: string[];
}

interface CspWindow {
  __csp: string[];
}
interface GameWindow {
  __game: { phase: string };
}

/** Records page errors, console errors, CSP console messages and `securitypolicyviolation` events. */
async function watch(page: Page): Promise<Watch> {
  const w: Watch = { consoleErrors: [], cspConsole: [] };
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as CspWindow).__csp = store;
    document.addEventListener('securitypolicyviolation', (e) => {
      store.push(
        `${e.violatedDirective} blocked ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`,
      );
    });
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Content Security Policy')) w.cspConsole.push(text);
    else if (msg.type() === 'error') w.consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    w.consoleErrors.push(`pageerror: ${err.message}`);
  });
  return w;
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as CspWindow).__csp.slice());
}

async function expectNoCspProblems(page: Page, w: Watch): Promise<void> {
  expect(await violations(page)).toEqual([]);
  expect(w.cspConsole).toEqual([]);
}

function bowlingRegistered(): boolean {
  const registry = readFileSync(new URL('../src/sports/registry.ts', import.meta.url), 'utf8');
  return /bowling\/meta/.test(registry);
}

test('the page response carries the security headers', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("connect-src 'self'");
  expect(h['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['permissions-policy']).toBe('camera=(self), microphone=(), geolocation=()');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(h['cross-origin-embedder-policy']).toBeUndefined();
});

test('the whole game runs under the CSP (warm-up to results)', async ({ page }) => {
  const w = await watch(page);
  await page.goto('/?sport=warmup&source=synthetic&skipGate=1&timeScale=4');
  await page.waitForFunction(
    () => (window as unknown as GameWindow).__game?.phase === 'results',
    undefined,
    { timeout: 60000 },
  );
  await expectNoCspProblems(page, w);
  expect(w.consoleErrors).toEqual([]);
});

test('the title and menu screens run under the CSP', async ({ page }) => {
  const w = await watch(page);
  await page.goto('/?input=debug&skipGate=1');
  await page.waitForSelector('.screen-title');
  await page.click('.screen-title .btn');
  await page.waitForSelector('.sport-card');
  await expectNoCspProblems(page, w);
  expect(w.consoleErrors).toEqual([]);
});

test('the camera pipeline runs under the CSP (WASM, module worker, models)', async ({ page }) => {
  const w = await watch(page);
  await page.goto('/tracking-harness.html?mode=crops');
  await page.waitForFunction(
    () => {
      const t = (window as unknown as { __tracking?: { frames: number; error: string | null } })
        .__tracking;
      return !!t && (t.frames >= 10 || t.error !== null);
    },
    undefined,
    { timeout: 60000 },
  );
  const snap = await page.evaluate(
    () =>
      (window as unknown as { __tracking: { frames: number; error: string | null } }).__tracking,
  );
  expect(snap.error).toBeNull();
  expect(snap.frames).toBeGreaterThanOrEqual(10);
  await expectNoCspProblems(page, w);
  expect(w.consoleErrors).toEqual([]);
});

test('Rapier (WASM) runs under the CSP', async ({ page }) => {
  test.skip(!bowlingRegistered(), 'bowling is not registered in src/sports/registry.ts yet');
  const w = await watch(page);
  await page.goto('/?sport=bowling&input=debug&skipGate=1&short=1');
  await page.waitForFunction(
    () => (window as unknown as GameWindow).__game?.phase === 'playing',
    undefined,
    { timeout: 60000 },
  );
  await expectNoCspProblems(page, w);
  expect(w.consoleErrors).toEqual([]);
});

test('the CSP blocks requests to other origins (the privacy promise)', async ({ page }) => {
  const w = await watch(page);
  await page.goto('/?input=debug&skipGate=1');
  await page.waitForSelector('.screen-title');
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' });
      return 'allowed';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
  await expect.poll(() => violations(page)).toEqual([expect.stringContaining('connect-src')]);
  expect(w.cspConsole.length).toBeGreaterThan(0);
});

async function swState(page: Page): Promise<{ active: boolean; cached: string[] }> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const names = await caches.keys();
    const cached: string[] = [];
    for (const name of names) {
      for (const req of await (await caches.open(name)).keys())
        cached.push(new URL(req.url).pathname);
    }
    return { active: reg?.active?.state === 'activated', cached };
  });
}

async function setOffline(context: BrowserContext, offline: boolean): Promise<void> {
  await context.setOffline(offline);
}

test.describe('service worker', () => {
  test('registers, caches the shell, works offline, and ?sw=0 removes it', async ({
    page,
    context,
  }) => {
    const w = await watch(page);
    await page.goto('/?sw=1&skipGate=1&input=debug');
    await page.waitForSelector('.screen-title');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(async () => (await swState(page)).active).toBe(true);
    // The precache is filled during install, before the worker activates.
    const first = await swState(page);
    expect(first.cached).toContain('/index.html');
    expect(first.cached.some((p) => p.startsWith('/assets/') && p.endsWith('.js'))).toBe(true);

    // Reload: the worker now controls the page and serves /assets/* from the cache.
    await page.reload();
    await page.waitForSelector('.screen-title');
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const assetTransfer = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('/assets/') && e.name.endsWith('.js'))
        .map((e) => (e as PerformanceResourceTiming).transferSize),
    );
    expect(assetTransfer.length).toBeGreaterThan(0);
    expect(assetTransfer.every((n) => n === 0)).toBe(true);

    // Offline: the shell still opens and shows the title screen.
    await setOffline(context, true);
    await page.reload();
    await page.waitForSelector('.screen-title', { timeout: 20000 });
    await setOffline(context, false);

    // ?sw=0 unregisters the worker and deletes its caches.
    await page.goto('/?sw=0&skipGate=1&input=debug');
    await page.waitForSelector('.screen-title');
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      )
      .toBe(0);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBe(0);
    await expectNoCspProblems(page, w);
  });

  test('is not registered in an automated browser without ?sw=1', async ({ page }) => {
    await page.goto('/?skipGate=1&input=debug');
    await page.waitForSelector('.screen-title');
    await page.waitForLoadState('load');
    const count = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    expect(count).toBe(0);
  });
});
