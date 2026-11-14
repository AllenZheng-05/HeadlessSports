/**
 * All MediaPipe logic. Used unchanged by the tracking worker and by the main-thread fallback, so
 * it must not touch the DOM (OffscreenCanvas and ImageBitmap exist in both places).
 */
import { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { HAND_COUNT, HAND_STRIDE, PoseIndex } from '../types';
import type { TrackerNeeds } from '../types';
import { HAND_MODEL_FILE, POSE_MODEL_FILES, wasmPaths } from './assets';
import type { WasmPaths } from './assets';
import { computeWristCrop, createCropRect, cropToImageX, cropToImageY } from './crop';
import { H_ASPECT, H_HAS_POSE, H_INFERENCE_MS, HAND_LEN, packHand, packPose } from './protocol';
import type { CoreOptions, DelegateName } from './protocol';
import { assignSlots, createSlotState, resetSlotState } from './slots';

const MIN_WRIST_VISIBILITY = 0.5;
const WARMUP_WIDTH = 320;
const WARMUP_HEIGHT = 180;

type Ctx2D = OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: OffscreenCanvas; ctx: Ctx2D } {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

export class TrackerCore {
  /** The delegate in effect after any GPU -> CPU fallback. */
  delegate: DelegateName;
  /** Debug crops produced by the latest process() call (null when not cropped or disabled). */
  readonly debugCrops: [ImageBitmap | null, ImageBitmap | null] = [null, null];
  debug = false;

  private readonly opts: CoreOptions;
  private readonly paths: WasmPaths;
  private needs: TrackerNeeds = { pose: false, handCrops: false, fullFrameHands: false };

  private pose: PoseLandmarker | null = null;
  private handCrop: HandLandmarker | null = null;
  private handVideo: HandLandmarker | null = null;

  private poseCanvas: OffscreenCanvas;
  private poseCtx: Ctx2D;
  private readonly cropCanvases: [OffscreenCanvas, OffscreenCanvas];
  private readonly cropCtxs: [Ctx2D, Ctx2D];

  private readonly rect = createCropRect();
  private readonly handLm = new Float32Array(2 * HAND_LEN);
  private readonly handPresent = new Uint8Array(2);
  private readonly handScore = new Float32Array(2);
  private readonly slotState = createSlotState();
  private readonly slotOut = new Int8Array(2);
  private readonly palmX = new Float32Array(2);
  private readonly palmY = new Float32Array(2);
  private frameCounter = 0;
  private loadCount = 0;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(opts: CoreOptions, inWorker: boolean) {
    this.opts = opts;
    this.delegate = opts.delegate;
    this.paths = wasmPaths(opts.wasmBase, inWorker);
    const p = makeCanvas(opts.poseInputWidth, Math.round((opts.poseInputWidth * 9) / 16));
    this.poseCanvas = p.canvas;
    this.poseCtx = p.ctx;
    const a = makeCanvas(opts.handCropSize, opts.handCropSize);
    const b = makeCanvas(opts.handCropSize, opts.handCropSize);
    this.cropCanvases = [a.canvas, b.canvas];
    this.cropCtxs = [a.ctx, b.ctx];
  }

  /**
   * Loads exactly the models `needs` asks for, closes the rest, and warms up the new ones. Calls
   * are serialised: an overlapping call waits for the previous one, so two loads never race on
   * the same slot. After close() a pending load closes whatever it created and rejects.
   */
  setNeeds(needs: TrackerNeeds): Promise<void> {
    const run = this.chain.then(() => this.applyNeeds(needs));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private checkOpen(): void {
    if (this.closed) throw new Error('tracker core was closed');
  }

  private async applyNeeds(needs: TrackerNeeds): Promise<void> {
    this.checkOpen();
    const wantPose = needs.pose;
    const wantCrops = needs.handCrops && needs.pose;
    const wantFull = needs.fullFrameHands;

    if (!wantPose && this.pose) {
      this.pose.close();
      this.pose = null;
    }
    if (!wantCrops && this.handCrop) {
      this.handCrop.close();
      this.handCrop = null;
    }
    if (!wantFull && this.handVideo) {
      this.handVideo.close();
      this.handVideo = null;
    }
    if (!wantCrops && !wantFull) {
      this.handPresent[0] = 0;
      this.handPresent[1] = 0;
    }
    if (!wantFull) resetSlotState(this.slotState);

    if (wantPose && !this.pose) {
      const path = this.opts.modelBase + POSE_MODEL_FILES[this.opts.poseModel];
      const pose = await this.create((delegate) =>
        PoseLandmarker.createFromOptions(this.nextPaths(), {
          baseOptions: { modelAssetPath: path, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        }),
      );
      if (this.closed) {
        pose.close();
        this.checkOpen();
      }
      this.pose = pose;
      pose.detectForVideo(this.warmCanvas(), 0);
    }
    if (wantCrops && !this.handCrop) {
      const hands = await this.createHands('IMAGE', 1);
      if (this.closed) {
        hands.close();
        this.checkOpen();
      }
      this.handCrop = hands;
      hands.detect(this.warmCanvas());
    }
    if (wantFull && !this.handVideo) {
      const hands = await this.createHands('VIDEO', 2);
      if (this.closed) {
        hands.close();
        this.checkOpen();
      }
      this.handVideo = hands;
      hands.detectForVideo(this.warmCanvas(), 0);
    }
    this.needs = { pose: wantPose, handCrops: wantCrops, fullFrameHands: wantFull };
  }

  /**
   * MediaPipe clears globalThis.ModuleFactory after each load, and `import()` runs a module body
   * only once per URL, so a second landmarker in the same worker would find no factory. A unique
   * query string per load gives each landmarker a fresh module instance.
   */
  private nextPaths(): WasmPaths {
    this.loadCount++;
    return {
      wasmLoaderPath: `${this.paths.wasmLoaderPath}?load=${this.loadCount}`,
      wasmBinaryPath: this.paths.wasmBinaryPath,
    };
  }

  private createHands(mode: 'IMAGE' | 'VIDEO', numHands: number): Promise<HandLandmarker> {
    const path = this.opts.modelBase + HAND_MODEL_FILE;
    return this.create((delegate) =>
      HandLandmarker.createFromOptions(this.nextPaths(), {
        baseOptions: { modelAssetPath: path, delegate },
        runningMode: mode,
        numHands,
      }),
    );
  }

  /** GPU first; if creation throws, switch the whole core to CPU and retry. */
  private async create<T>(make: (delegate: DelegateName) => Promise<T>): Promise<T> {
    if (this.delegate === 'GPU') {
      try {
        return await make('GPU');
      } catch (err) {
        console.info(
          `[tracking] GPU delegate failed, falling back to CPU: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.delegate = 'CPU';
      }
    }
    return make('CPU');
  }

  private warmCanvas(): OffscreenCanvas {
    const { canvas, ctx } = makeCanvas(WARMUP_WIDTH, WARMUP_HEIGHT);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, WARMUP_WIDTH, WARMUP_HEIGHT);
    return canvas;
  }

  /**
   * Runs the loaded trackers on one frame and writes the packed result into `out`. Does not
   * close the bitmap (the caller owns it). No allocation here beyond what MediaPipe makes.
   */
  process(bitmap: ImageBitmap, t: number, out: Float32Array): void {
    const w = bitmap.width;
    const h = bitmap.height;
    out[H_ASPECT] = w / h;
    out[H_HAS_POSE] = 0;
    let inferMs = 0;
    this.debugCrops[0] = null;
    this.debugCrops[1] = null;

    if (this.needs.pose || this.needs.fullFrameHands) this.drawDownscaled(bitmap, w, h);

    let wristLm: readonly { x: number; y: number; visibility: number }[] | null = null;
    if (this.needs.pose && this.pose) {
      const t0 = performance.now();
      const res = this.pose.detectForVideo(this.poseCanvas, t);
      inferMs += performance.now() - t0;
      const lm = res.landmarks[0];
      const world = res.worldLandmarks[0];
      if (lm && world) {
        packPose(out, lm, world);
        out[H_HAS_POSE] = 1;
        wristLm = lm;
      }
    }

    if (this.needs.fullFrameHands && this.handVideo) {
      const t0 = performance.now();
      const res = this.handVideo.detectForVideo(this.poseCanvas, t);
      inferMs += performance.now() - t0;
      this.assignFullFrameHands(res);
    } else if (this.needs.handCrops && this.handCrop) {
      const alternate = this.opts.handCropMode === 'alternate';
      const only = this.frameCounter & 1;
      for (let i = 0; i < 2; i++) {
        if (alternate && i !== only) {
          // Not observed this frame: report it absent so the input layer does not see the
          // previous frame's landmarks twice. It keeps its last known state meanwhile.
          this.handPresent[i] = 0;
          this.handScore[i] = 0;
          continue;
        }
        inferMs += this.cropHand(bitmap, w, h, i, wristLm);
      }
    }
    this.frameCounter++;

    for (let i = 0; i < 2; i++) {
      packHand(out, i, this.handPresent[i] === 1, this.handScore[i], this.handLm, i * HAND_LEN);
    }
    out[H_INFERENCE_MS] = inferMs;
  }

  private drawDownscaled(bitmap: ImageBitmap, w: number, h: number): void {
    const pw = Math.min(this.opts.poseInputWidth, w);
    const ph = Math.round((pw * h) / w);
    if (this.poseCanvas.width !== pw || this.poseCanvas.height !== ph) {
      this.poseCanvas.width = pw;
      this.poseCanvas.height = ph;
    }
    this.poseCtx.drawImage(bitmap, 0, 0, pw, ph);
  }

  /** Returns inference time in ms. */
  private cropHand(
    bitmap: ImageBitmap,
    w: number,
    h: number,
    hand: number,
    lm: readonly { x: number; y: number; visibility: number }[] | null,
  ): number {
    this.handPresent[hand] = 0;
    this.handScore[hand] = 0;
    if (!lm || !this.handCrop) return 0;
    const wrist = lm[hand === 0 ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST];
    const elbow = lm[hand === 0 ? PoseIndex.LEFT_ELBOW : PoseIndex.RIGHT_ELBOW];
    if (wrist.visibility <= MIN_WRIST_VISIBILITY || elbow.visibility <= MIN_WRIST_VISIBILITY) {
      return 0;
    }
    const rect = this.rect;
    if (!computeWristCrop(wrist.x, wrist.y, elbow.x, elbow.y, w, h, rect)) return 0;

    const cs = this.opts.handCropSize;
    const ctx = this.cropCtxs[hand];
    ctx.drawImage(bitmap, rect.x, rect.y, rect.side, rect.side, 0, 0, cs, cs);
    const t0 = performance.now();
    const res = this.handCrop.detect(this.cropCanvases[hand]);
    const ms = performance.now() - t0;
    if (this.debug) this.debugCrops[hand] = this.cropCanvases[hand].transferToImageBitmap();

    const pts = res.landmarks[0];
    if (!pts || pts.length < HAND_COUNT) return ms;
    const o = hand * HAND_LEN;
    const zScale = rect.side / w;
    for (let i = 0; i < HAND_COUNT; i++) {
      const p = pts[i];
      const k = o + i * HAND_STRIDE;
      this.handLm[k] = 1 - cropToImageX(rect, p.x, w);
      this.handLm[k + 1] = cropToImageY(rect, p.y, h);
      this.handLm[k + 2] = p.z * zScale;
    }
    this.handPresent[hand] = 1;
    this.handScore[hand] = res.handedness[0]?.[0]?.score ?? 1;
    return ms;
  }

  private assignFullFrameHands(res: HandLandmarkerResult): void {
    const n = res.landmarks.length > 2 ? 2 : res.landmarks.length;
    for (let d = 0; d < n; d++) {
      const palm = res.landmarks[d][9];
      this.palmX[d] = 1 - palm.x;
      this.palmY[d] = palm.y;
    }
    assignSlots(this.palmX, this.palmY, n, this.slotState, this.slotOut);
    for (let s = 0; s < 2; s++) {
      const d = this.slotOut[s];
      if (d < 0) {
        this.handPresent[s] = 0;
        this.handScore[s] = 0;
        continue;
      }
      const pts = res.landmarks[d];
      const o = s * HAND_LEN;
      for (let i = 0; i < HAND_COUNT; i++) {
        const p = pts[i];
        const k = o + i * HAND_STRIDE;
        this.handLm[k] = 1 - p.x;
        this.handLm[k + 1] = p.y;
        this.handLm[k + 2] = p.z;
      }
      this.handPresent[s] = 1;
      this.handScore[s] = res.handedness[d]?.[0]?.score ?? 1;
    }
  }

  close(): void {
    this.closed = true;
    this.pose?.close();
    this.handCrop?.close();
    this.handVideo?.close();
    this.pose = null;
    this.handCrop = null;
    this.handVideo = null;
    this.needs = { pose: false, handCrops: false, fullFrameHands: false };
  }
}
