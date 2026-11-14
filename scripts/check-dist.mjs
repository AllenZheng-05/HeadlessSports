// Checks a build output directory before deploy: prints the largest files and the total, and fails
// if any file is over Cloudflare's 25 MiB per-file limit or the WASM / model files are missing
// (which means `pnpm setup:assets` was not run before the build).
// Usage: node scripts/check-dist.mjs [dir]   (default: dist)
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const LIMIT = 25 * 1024 * 1024;
const REQUIRED = [
  'index.html',
  'sw.js',
  '_headers',
  '404.html',
  'models/pose_landmarker_lite.task',
  'models/pose_landmarker_full.task',
  'models/hand_landmarker.task',
];
const REQUIRED_WASM = ['vision_wasm_internal.wasm', 'vision_wasm_module_internal.wasm'];

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else
      out.push({ path: relative(root, full).split(sep).join('/'), size: (await stat(full)).size });
  }
  return out;
}

const root = resolve(process.argv[2] ?? 'dist');
if (!existsSync(root)) {
  console.error(`[check-dist] ${root} does not exist. Run "pnpm build" first.`);
  process.exit(1);
}

const files = await walk(root);
const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const problems = [];

console.info(
  `[check-dist] ${root}: ${files.length} files, ${mib(files.reduce((a, f) => a + f.size, 0))} total`,
);
console.info('[check-dist] ten largest files:');
for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 10)) {
  console.info(`  ${mib(f.size).padStart(11)}  ${f.path}`);
}

for (const f of files) {
  if (f.size > LIMIT) problems.push(`${f.path} is ${mib(f.size)}, over the 25 MiB per-file limit`);
}
for (const name of REQUIRED) {
  if (!files.some((f) => f.path === name)) problems.push(`missing ${name}`);
}
for (const name of REQUIRED_WASM) {
  if (
    !files.some((f) => /^wasm\/tasks-vision-[^/]+\//.test(f.path) && f.path.endsWith(`/${name}`))
  ) {
    problems.push(`missing wasm/tasks-vision-<version>/${name}`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`[check-dist] FAIL: ${p}`);
  if (problems.some((p) => p.includes('wasm') || p.includes('models'))) {
    console.error('[check-dist] Run "pnpm setup:assets" and build again.');
  }
  process.exit(1);
}
console.info('[check-dist] OK');
