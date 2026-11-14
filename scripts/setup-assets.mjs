// Idempotent asset setup: copies MediaPipe WASM files into public/ and
// downloads MediaPipe model files into public/models/.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODELS = [
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
];

function log(message) {
  console.info(`[setup-assets] ${message}`);
}

async function copyWasm() {
  const srcDir = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  const pkg = JSON.parse(
    await readFile(
      join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'),
      'utf8',
    ),
  );
  const destDir = join(ROOT, 'public', 'wasm', `tasks-vision-${pkg.version}`);
  await mkdir(destDir, { recursive: true });

  const files = await readdir(srcDir);
  let copied = 0;
  let skipped = 0;
  for (const file of files) {
    const src = join(srcDir, file);
    const dest = join(destDir, file);
    const srcStat = await stat(src);
    if (!srcStat.isFile()) continue;
    if (existsSync(dest) && (await stat(dest)).size === srcStat.size) {
      skipped += 1;
      continue;
    }
    await copyFile(src, dest);
    copied += 1;
  }
  log(`wasm ${pkg.version}: ${copied} copied, ${skipped} already present -> ${destDir}`);
}

async function downloadModel(url) {
  const name = url.slice(url.lastIndexOf('/') + 1);
  const dest = join(ROOT, 'public', 'models', name);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    log(`model ${name}: already present, skipping`);
    return;
  }
  log(`model ${name}: downloading`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  log(`model ${name}: saved (${(await stat(dest)).size} bytes)`);
}

try {
  await mkdir(join(ROOT, 'public', 'models'), { recursive: true });
  await copyWasm();
  for (const url of MODELS) {
    await downloadModel(url);
  }
  log('done');
} catch (err) {
  console.error(`[setup-assets] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
