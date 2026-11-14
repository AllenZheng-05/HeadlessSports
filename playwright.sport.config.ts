import { defineConfig } from '@playwright/test';

/**
 * Per-sport Playwright config, so several sports can be built and checked at the same time
 * without sharing a build directory or a port.
 *
 *   PowerShell:  $env:SPORT='climbing'; pnpm exec vite build --outDir dist-climbing; pnpm exec playwright test --config playwright.sport.config.ts
 *   bash:        SPORT=climbing pnpm exec vite build --outDir dist-climbing && SPORT=climbing pnpm exec playwright test --config playwright.sport.config.ts
 *
 * It runs only e2e/sports/<SPORT>.spec.ts against its own preview server. The default config
 * (pnpm test:e2e) runs every spec under e2e/, including e2e/sports/, against dist/.
 */

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

const PORTS: Record<string, number> = {
  warmup: 4200,
  climbing: 4201,
  bowling: 4202,
  batting: 4203,
  archery: 4204,
  javelin: 4205,
  pitching: 4206,
};

const sport = process.env.SPORT ?? '';
const port = PORTS[sport];
if (!port) {
  throw new Error(`Set SPORT to one of: ${Object.keys(PORTS).join(', ')}`);
}

export default defineConfig({
  testDir: 'e2e/sports',
  testMatch: `${sport}.spec.ts`,
  timeout: 180000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 720 },
    permissions: ['camera'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir dist-${sport} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
