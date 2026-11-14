import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

export default defineConfig({
  testDir: 'e2e-gate',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4193',
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
          ],
        },
        permissions: ['camera'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --outDir dist-gate --port 4193 --strictPort',
    url: 'http://localhost:4193',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
