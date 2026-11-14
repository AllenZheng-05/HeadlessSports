import { defineConfig } from '@playwright/test';

/**
 * Memory soak config. Run with `pnpm test:soak` (builds into dist-soak, serves it on port 4230).
 * Durations come from SOAK_MINUTES (per scenario, default 4); see e2e-soak/README.md.
 */

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

const minutes = Number(process.env.SOAK_MINUTES ?? '4');
const perScenarioMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 4) * 60000;
/** The rotation scenario may run up to twice as long to finish two full cycles. */
const MARGIN_MS = 3 * 60000;

export default defineConfig({
  testDir: 'e2e-soak',
  timeout: perScenarioMs + MARGIN_MS,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4230',
    viewport: { width: 1280, height: 720 },
    permissions: ['camera'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--enable-precise-memory-info',
            '--js-flags=--expose-gc',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --outDir dist-soak --port 4230 --strictPort',
    url: 'http://localhost:4230',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
