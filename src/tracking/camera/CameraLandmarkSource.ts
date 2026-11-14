import type {
  FrameListener,
  LandmarkFrame,
  LandmarkSource,
  TrackerNeeds,
  TrackingStats,
} from '../types';
import { modelBaseUrl, wasmBaseUrl } from './assets';
import { checkResolution, createTrackingError, mapCameraError } from './errors';
import { PACKED_LEN, createFrame, unpackFrame } from './protocol';
import type {
  CameraDebug,
  CoreOptions,
  DelegateName,
  FromWorker,
  FrameMsg,
  HandCropMode,
  PoseModelName,
  ToWorker,
} from './protocol';
import type { TrackerCore } from './trackerCore';

export type { CameraDebug } from './protocol';

export interface CameraSourceOptions {
  poseModel?: PoseModelName;
  delegate?: DelegateName;
  forceMainThread?: boolean;
  handCropMode?: HandCropMode;
  poseInputWidth?: number;
  handCropSize?: number;
}

const WORKER_INIT_TIMEOUT_MS = 20000;
const MEDIAN_WINDOW = 30;
const HZ_RING = 128;
const LATENCY_SMOOTHING = 0.1;

interface Pending {
  resolve: () => void;
  reject: (err: Error) => void;
}

type DebugCallback = (left: ImageBitmap | null, right: ImageBitmap | null) => void;

class CameraSource implements LandmarkSource, CameraDebug {
  readonly kind = 'camera' as const;
  readonly video: HTMLVideoElement;
  readonly stats: TrackingStats = {
    inferenceMs: 0,
    trackingHz: 0,
    latencyMs: 0,
    droppedFrames: 0,
    delegate: 'none',
    inWorker: false,
  };

  private readonly options: CoreOptions;
  private readonly forceMainThread: boolean;
  private readonly frame: LandmarkFrame = createFrame();
  private listeners: FrameListener[] = [];
  private debugListeners: DebugCallback[] = [];
  private debugEnabled = false;

  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private core: TrackerCore | null = null;
  private pending: Pending | null = null;
  private started = false;
  private running = false;
  private rvfcHandle = 0;

  // Frame pipeline state.
  private busy = false;
  private changingNeeds = false;
  private lastT = -Infinity;
  private pendingT = 0;
  private spare: Float32Array | null = new Float32Array(PACKED_LEN);
  private readonly frameMsg: FrameMsg;
  private readonly frameTransfer: Transferable[] = [];

  // Stats state.
  private readonly infRing = new Float32Array(MEDIAN_WINDOW);
  private readonly infScratch = new Float32Array(MEDIAN_WINDOW);
  private infCount = 0;
  private infHead = 0;
  private readonly hzRing = new Float64Array(HZ_RING);
  private hzHead = 0;
  private hzCount = 0;

  constructor(opts: CameraSourceOptions) {
    this.forceMainThread = opts.forceMainThread ?? false;
    this.options = {
      wasmBase: '',
      modelBase: '',
      poseModel: opts.poseModel ?? 'lite',
      delegate: opts.delegate ?? 'GPU',
      handCropMode: opts.handCropMode ?? 'both',
      poseInputWidth: opts.poseInputWidth ?? 640,
      handCropSize: opts.handCropSize ?? 256,
    };
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.frameMsg = {
      type: 'frame',
      bitmap: undefined as unknown as ImageBitmap,
      t: 0,
      buffer: this.spare as Float32Array,
    };
  }

  // ---- LandmarkSource ----

  async start(needs: TrackerNeeds): Promise<void> {
    if (this.started) throw new Error('CameraSource.start() called twice');
    this.started = true;
    this.options.wasmBase = wasmBaseUrl();
    this.options.modelBase = modelBaseUrl();
    try {
      await this.openCamera();
      await this.initBackend(needs);
    } catch (err) {
      this.stop();
      throw err;
    }
    if (!this.started) return;
    this.running = true;
    this.rvfcHandle = this.video.requestVideoFrameCallback(this.onVideoFrame);
  }

  async setNeeds(needs: TrackerNeeds): Promise<void> {
    this.changingNeeds = true;
    try {
      if (this.worker) {
        await this.requestWorker({ type: 'needs', needs });
      } else if (this.core) {
        await this.core.setNeeds(needs);
        this.stats.delegate = this.core.delegate;
      }
    } catch (err) {
      throw createTrackingError(
        'model-load-failed',
        `Could not load trackers: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      this.changingNeeds = false;
    }
  }

  pump(_nowMs: number): void {
    // Frames are delivered as they arrive.
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  stop(): void {
    this.started = false;
    this.running = false;
    if (this.rvfcHandle) {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
      this.rvfcHandle = 0;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    if (this.core) {
      this.core.close();
      this.core = null;
    }
    this.pending = null;
    this.stats.delegate = 'none';
  }

  // ---- CameraDebug ----

  setDebugCrops(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (this.worker) {
      const msg: ToWorker = { type: 'debug', enabled };
      this.worker.postMessage(msg);
    }
    if (this.core) this.core.debug = enabled;
  }

  onDebugCrops(cb: DebugCallback): () => void {
    this.debugListeners = [...this.debugListeners, cb];
    return () => {
      this.debugListeners = this.debugListeners.filter((l) => l !== cb);
    };
  }

  // ---- Camera ----

  private async openCamera(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (err) {
      throw mapCameraError(err);
    }
    this.stream = stream;
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (err) {
      throw mapCameraError(err);
    }
    if (this.video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    }
    const low = checkResolution(this.video.videoWidth, this.video.videoHeight);
    if (low) throw low;
  }

  // ---- Backend (worker, with main-thread fallback) ----

  private async initBackend(needs: TrackerNeeds): Promise<void> {
    if (!this.forceMainThread) {
      try {
        await this.initWorker(needs);
        this.stats.inWorker = true;
        return;
      } catch (err) {
        console.warn(
          `[tracking] worker unavailable, using the main thread: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.disposeWorker();
      }
    }
    await this.initMainThread(needs);
    this.stats.inWorker = false;
  }

  private initWorker(needs: TrackerNeeds): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`worker did not become ready within ${WORKER_INIT_TIMEOUT_MS} ms`));
      }, WORKER_INIT_TIMEOUT_MS);
      this.pending = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      worker.onmessage = this.onWorkerMessage;
      worker.onerror = (e) => {
        e.preventDefault();
        const p = this.pending;
        this.pending = null;
        const err = new Error(e.message || 'worker error');
        if (p) p.reject(err);
        else console.error(`[tracking] worker error: ${err.message}`);
      };
      const init: ToWorker = {
        type: 'init',
        options: this.options,
        needs,
        debug: this.debugEnabled,
      };
      worker.postMessage(init);
    });
  }

  private disposeWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.pending = null;
  }

  private async initMainThread(needs: TrackerNeeds): Promise<void> {
    try {
      const { TrackerCore } = await import('./trackerCore');
      const core = new TrackerCore(this.options, false);
      core.debug = this.debugEnabled;
      this.core = core;
      await core.setNeeds(needs);
      this.stats.delegate = core.delegate;
    } catch (err) {
      throw createTrackingError(
        'model-load-failed',
        `Could not load trackers: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /** Posts a control message and resolves when the worker answers 'ready' or 'needs-ready'. */
  private requestWorker(msg: ToWorker): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker?.postMessage(msg);
    });
  }

  private readonly onWorkerMessage = (e: MessageEvent<FromWorker>): void => {
    const msg = e.data;
    switch (msg.type) {
      case 'result': {
        this.onResult(msg.ok, msg.buffer, msg.dbgLeft, msg.dbgRight);
        break;
      }
      case 'ready':
      case 'needs-ready': {
        this.stats.delegate = msg.delegate;
        const p = this.pending;
        this.pending = null;
        p?.resolve();
        break;
      }
      case 'error': {
        if (msg.phase === 'frame') {
          console.error(`[tracking] frame failed: ${msg.message}`);
        } else {
          const p = this.pending;
          this.pending = null;
          p?.reject(new Error(msg.message));
        }
        break;
      }
    }
  };

  // ---- Frame loop ----

  private readonly onVideoFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
    if (!this.running) return;
    this.rvfcHandle = this.video.requestVideoFrameCallback(this.onVideoFrame);
    if (this.changingNeeds) return;
    const t = meta.captureTime ?? meta.presentationTime ?? meta.expectedDisplayTime;
    if (!(t > this.lastT)) return;
    if (this.busy) {
      this.stats.droppedFrames++;
      return;
    }
    this.busy = true;
    this.lastT = t;
    this.pendingT = t;
    createImageBitmap(this.video).then(this.onBitmap, this.onBitmapError);
  };

  private readonly onBitmapError = (err: unknown): void => {
    this.busy = false;
    if (this.running) console.error(`[tracking] createImageBitmap failed: ${String(err)}`);
  };

  private readonly onBitmap = (bitmap: ImageBitmap): void => {
    const buffer = this.spare;
    if (!this.running || this.changingNeeds || !buffer) {
      bitmap.close();
      this.busy = false;
      return;
    }
    if (this.worker) {
      this.spare = null;
      const msg = this.frameMsg;
      msg.bitmap = bitmap;
      msg.t = this.pendingT;
      msg.buffer = buffer;
      this.frameTransfer[0] = bitmap;
      this.frameTransfer[1] = buffer.buffer;
      this.worker.postMessage(msg, this.frameTransfer);
      return;
    }
    const core = this.core;
    if (!core) {
      bitmap.close();
      this.busy = false;
      return;
    }
    let ok = true;
    try {
      core.process(bitmap, this.pendingT, buffer);
    } catch (err) {
      ok = false;
      console.error(`[tracking] frame failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    bitmap.close();
    this.spare = null;
    this.onResult(ok, buffer, core.debugCrops[0], core.debugCrops[1]);
  };

  private onResult(
    ok: boolean,
    buffer: Float32Array,
    dbgLeft: ImageBitmap | null,
    dbgRight: ImageBitmap | null,
  ): void {
    this.spare = buffer;
    this.busy = false;
    if (dbgLeft || dbgRight) this.deliverDebug(dbgLeft, dbgRight);
    if (!ok || !this.running) return;

    const frame = this.frame;
    unpackFrame(buffer, frame);
    frame.t = this.pendingT;
    frame.seq++;

    const now = performance.now();
    this.updateStats(frame.inferenceMs, now, now - frame.t);

    for (const listener of this.listeners) listener(frame);
  }

  private deliverDebug(left: ImageBitmap | null, right: ImageBitmap | null): void {
    const ds = this.debugListeners;
    if (ds.length === 0) {
      left?.close();
      right?.close();
      return;
    }
    for (const cb of ds) cb(left, right);
  }

  private updateStats(inferenceMs: number, now: number, latency: number): void {
    const s = this.stats;

    this.infRing[this.infHead] = inferenceMs;
    this.infHead = (this.infHead + 1) % MEDIAN_WINDOW;
    if (this.infCount < MEDIAN_WINDOW) this.infCount++;
    const scratch = this.infScratch;
    scratch.set(this.infRing);
    for (let i = this.infCount; i < MEDIAN_WINDOW; i++) scratch[i] = Infinity;
    scratch.sort();
    s.inferenceMs = scratch[(this.infCount - 1) >> 1];

    this.hzRing[this.hzHead] = now;
    this.hzHead = (this.hzHead + 1) % HZ_RING;
    if (this.hzCount < HZ_RING) this.hzCount++;
    let n = 0;
    for (let i = 0; i < this.hzCount; i++) {
      if (now - this.hzRing[i] <= 1000) n++;
    }
    s.trackingHz = n;

    s.latencyMs =
      this.frame.seq === 1 ? latency : s.latencyMs + (latency - s.latencyMs) * LATENCY_SMOOTHING;
  }
}

export function createCameraSource(
  options: CameraSourceOptions = {},
): LandmarkSource & CameraDebug {
  return new CameraSource(options);
}
