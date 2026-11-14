import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { Plugin } from 'vite';
import { MEDIAPIPE_VERSION } from '../core/version';
import { buildIdFromFiles } from './cacheNames';
import { buildPrecacheList } from './precache';
import type { BundleEntry } from './precache';

/**
 * Emits /sw.js (unhashed, site root) at the end of a production build. The worker is bundled in a
 * nested Vite build (no app code is imported) with the precache list and a build id injected as
 * constants. The list comes from the main bundle: index.html's entry chunk, its static imports, CSS
 * and fonts. Sport chunks, WASM, models and the other HTML pages are cached lazily by the worker.
 */
export function serviceWorkerPlugin(): Plugin {
  let precache: string[] = [];
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'headless-sports-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const view: Record<string, BundleEntry> = {};
      for (const [file, item] of Object.entries(bundle)) {
        if (item.type === 'asset') {
          view[file] = { fileName: file, type: 'asset' };
          continue;
        }
        const meta = (
          item as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }
        ).viteMetadata;
        view[file] = {
          fileName: file,
          type: 'chunk',
          isEntry: item.isEntry,
          name: item.name,
          imports: item.imports,
          importedCss: [...(meta?.importedCss ?? [])],
          importedAssets: [...(meta?.importedAssets ?? [])],
        };
      }
      precache = buildPrecacheList(view);
    },
    async closeBundle() {
      // Rolldown drops empty CSS-only chunks after generateBundle; never precache a file that is not on disk.
      const outRoot = resolve(root, outDir);
      precache = precache.filter((u) => u === '/' || existsSync(resolve(outRoot, u.slice(1))));
      if (precache.length === 0) return;
      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __BUILD_ID__: JSON.stringify(buildIdFromFiles(precache)),
          __PRECACHE__: JSON.stringify(precache),
          __WASM_VERSION__: JSON.stringify(MEDIAPIPE_VERSION),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: 'es2022',
          minify: true,
          lib: {
            entry: fileURLToPath(new URL('./worker.ts', import.meta.url)),
            formats: ['iife'],
            name: 'HeadlessSportsSw',
            fileName: () => 'sw.js',
          },
        },
      });
    },
  };
}
