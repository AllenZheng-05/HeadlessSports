import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

// Own config, build output and port so it never collides with the main e2e run.
// Build first: pnpm exec vite build --outDir dist-ui
export default defineConfig({
  testDir: 'e2e-ui',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4183',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --outDir dist-ui --port 4183 --strictPort',
    url: 'http://localhost:4183',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
