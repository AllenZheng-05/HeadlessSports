import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { serviceWorkerPlugin } from './src/sw/plugin';
import { SECURITY_HEADERS } from './src/sw/securityHeaders';

export default defineConfig({
  plugins: [serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        debug: fileURLToPath(new URL('./debug.html', import.meta.url)),
        trackingHarness: fileURLToPath(new URL('./tracking-harness.html', import.meta.url)),
        uiHarness: fileURLToPath(new URL('./ui-harness.html', import.meta.url)),
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    // The same headers Cloudflare sends (public/_headers), so tests run under the real policy.
    headers: { ...SECURITY_HEADERS },
  },
});
