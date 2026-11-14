/**
 * Tracker benchmark for the device gate. Runs the real tracking worker (pose only, same code path
 * and model as the game) on a synthetic 1280x720 frame, back to back, with no camera.
 */
import { median } from '../../core/gate/evaluate';
import { modelBaseUrl, wasmBaseUrl } from './assets';
import { PACKED_LEN, H_INFERENCE_MS } from './protocol';
import type {
  CoreOptions,
  FromWorker,
  FrameMsg,
  InitMsg,
  PoseModelName,
  ToWorker,
} from './protocol';
import type { TrackerCore } from './trackerCore';

export interface TrackerBenchmarkOptions {
  poseModel: 'lite' | 'full';
  warmupInferences: number;
  durationMs: number;
  forceMainThread?: boolean;
  /** Default 1280. */
  width?: number;
  /** Default 720. */
  height?: number;
  /** Called once the models are loaded and the warm-up inferences start. */
  onWarmupStart?: () => void;
  /** Called when warm-up is done and the measured window begins. */
  onMeasureStart?: () => void;
}

export interface TrackerBenchmarkResult {
  /** Median inference time (ms). */
  inferenceMs: number;
  /** Completed inferences per second, run back to back. */
  hz: number;
  samples: number;
  delegate: 'GPU' | 'CPU' | 'none';
  inWorker: boolean;
}

const WORKER_INIT_TIMEOUT_MS = 20000;
const FRAME_STEP_MS = 33;
const MAX_SAMPLES = 4096;
const MAX_CONSECUTIVE_FAILURES = 3;

interface Backend {
  readonly inWorker: boolean;
  readonly delegate: 'GPU' | 'CPU';
  /** Runs one inference. Resolves with the inference time in ms, or rejects. */
  infer(bitmap: ImageBitmap, t: number): Promise<number>;
  close(): void;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function makeFrameCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
  else {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas context unavailable');
  // Mid-grey gradient plus a few shapes; the content does not matter, the model pass has a fixed cost.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#6a6a6a');
  g.addColorStop(1, '#a0a0a0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3d5a80';
  ctx.fillRect(w * 0.1, h * 0.55, w * 0.25, h * 0.35);
  ctx.fillStyle = '#e0a458';
  ctx.beginPath();
  ctx.arc(w * 0.7, h * 0.35, h * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9d6df';
  ctx.fillRect(w * 0.45, h * 0.2, w * 0.1, h * 0.6);
  return canvas;
}

function startWorker(options: CoreOptions): Promise<Backend> {
  return new Promise<Backend>((resolve, reject) => {
    const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    let spare: Float32Array | null = new Float32Array(PACKED_LEN);
    let waiting: { resolve: (ms: number) => void; reject: (e: Error) => void } | null = null;
    let initDelegate: 'GPU' | 'CPU' = 'CPU';
    let lastFrameError = '';
    const transfer: Transferable[] = [];

    const kill = (): void => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      kill();
      reject(new Error(`worker did not become ready within ${WORKER_INIT_TIMEOUT_MS} ms`));
    }, WORKER_INIT_TIMEOUT_MS);

    const backend: Backend = {
      inWorker: true,
      get delegate() {
        return initDelegate;
      },
      infer(bitmap, t) {
        return new Promise<number>((res, rej) => {
          const buffer = spare;
          if (!buffer) {
            bitmap.close();
            rej(new Error('benchmark frame already in flight'));
            return;
          }
          spare = null;
          waiting = { resolve: res, reject: rej };
          const msg: FrameMsg = { type: 'frame', bitmap, t, buffer };
          transfer[0] = bitmap;
          transfer[1] = buffer.buffer;
          worker.postMessage(msg, transfer);
        });
      },
      close() {
        try {
          const stop: ToWorker = { type: 'stop' };
          worker.postMessage(stop);
        } catch {
          // Terminating below is enough.
        }
        kill();
        waiting?.reject(new Error('benchmark closed'));
        waiting = null;
      },
    };

    worker.onmessage = (e: MessageEvent<FromWorker>): void => {
      const msg = e.data;
      switch (msg.type) {
        case 'ready':
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          initDelegate = msg.delegate;
          resolve(backend);
          break;
        case 'error':
          if (msg.phase === 'frame') {
            lastFrameError = msg.message;
          } else if (!settled) {
            settled = true;
            clearTimeout(timer);
            kill();
            reject(new Error(msg.message));
          }
          break;
        case 'result': {
          spare = msg.buffer;
          const w = waiting;
          waiting = null;
          if (!w) break;
          if (msg.ok) w.resolve(msg.buffer[H_INFERENCE_MS] as number);
          else w.reject(new Error(lastFrameError || 'frame failed'));
          break;
        }
        case 'needs-ready':
          break;
      }
    };
    worker.onerror = (e: ErrorEvent): void => {
      e.preventDefault();
      const err = new Error(e.message || 'worker error');
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        kill();
        reject(err);
      } else {
        waiting?.reject(err);
        waiting = null;
      }
    };
    const init: InitMsg = {
      type: 'init',
      options,
      needs: { pose: true, handCrops: false, fullFrameHands: false },
      debug: false,
    };
    worker.postMessage(init);
  });
}

async function startMainThread(options: CoreOptions): Promise<Backend> {
  const { TrackerCore } = await import('./trackerCore');
  const core: TrackerCore = new TrackerCore(options, false);
  try {
    await core.setNeeds({ pose: true, handCrops: false, fullFrameHands: false });
  } catch (err) {
    core.close();
    throw err;
  }
  const buffer = new Float32Array(PACKED_LEN);
  return {
    inWorker: false,
    delegate: core.delegate,
    async infer(bitmap, t) {
      try {
        core.process(bitmap, t, buffer);
      } finally {
        bitmap.close();
      }
      // Give the page (and the render benchmark) a turn between inferences.
      await new Promise<void>((r) => setTimeout(r, 0));
      return buffer[H_INFERENCE_MS] as number;
    },
    close() {
      core.close();
    },
  };
}

export async function benchmarkTracker(
  options: TrackerBenchmarkOptions,
): Promise<TrackerBenchmarkResult> {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const poseModel: PoseModelName = options.poseModel;
  const coreOptions: CoreOptions = {
    wasmBase: wasmBaseUrl(),
    modelBase: modelBaseUrl(),
    poseModel,
    delegate: 'GPU',
    handCropMode: 'both',
    poseInputWidth: 640,
    handCropSize: 256,
  };

  let backend: Backend | null = null;
  if (options.forceMainThread !== true) {
    try {
      backend = await startWorker(coreOptions);
    } catch (err) {
      console.warn(`[gate] worker unavailable, using the main thread: ${errMessage(err)}`);
    }
  }
  backend ??= await startMainThread(coreOptions);

  const source = makeFrameCanvas(width, height);
  const times = new Float32Array(MAX_SAMPLES);
  let samples = 0;
  let failures = 0;
  let seq = 0;

  const runOne = async (): Promise<boolean> => {
    const bitmap = await createImageBitmap(source);
    seq++;
    try {
      const ms = await backend.infer(bitmap, seq * FRAME_STEP_MS);
      failures = 0;
      if (samples < MAX_SAMPLES) times[samples] = ms;
      return true;
    } catch (err) {
      if (++failures >= MAX_CONSECUTIVE_FAILURES) throw err;
      return false;
    }
  };

  try {
    options.onWarmupStart?.();
    for (let i = 0; i < options.warmupInferences;) {
      if (await runOne()) i++;
    }
    options.onMeasureStart?.();
    const start = performance.now();
    let end = start;
    do {
      if (await runOne()) {
        samples++;
        end = performance.now();
      }
    } while (performance.now() - start < options.durationMs);

    const seconds = (end - start) / 1000;
    return {
      inferenceMs: median(times, Math.min(samples, MAX_SAMPLES)),
      hz: seconds > 0 ? samples / seconds : 0,
      samples,
      delegate: backend.delegate,
      inWorker: backend.inWorker,
    };
  } finally {
    backend.close();
  }
}
