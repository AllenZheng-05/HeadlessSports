import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

// Deploy checks: a production build in dist-deploy, served by `vite preview` with the real
// security headers (see src/sw/securityHeaders.ts). Run `pnpm exec vite build --outDir dist-deploy` first.
export default defineConfig({
  testDir: 'e2e-deploy',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4220',
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
    command: 'pnpm exec vite preview --outDir dist-deploy --port 4220 --strictPort',
    url: 'http://localhost:4220',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
