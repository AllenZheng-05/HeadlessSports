import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '../styles/base.css';
import './debug.css';
import { Vector3 } from 'three/webgpu';
import { parseFlags } from '../core/flags';
import { FrameProcessor } from '../input/FrameProcessor';
import { createInputState } from '../input/state';
import type { InputState } from '../input/types';
import { createRenderer } from '../render/renderer';
import type { RendererHandle } from '../render/renderer';
import { AvatarRig } from '../render/avatar/AvatarRig';
import { BlobShadow } from '../render/style/blobShadow';
import { createFieldDayScene } from '../render/style/scene';
import type { CameraDebug } from '../tracking/camera/CameraLandmarkSource';
import { createLandmarkSource } from '../tracking/createSource';
import { listClips, loadClip } from '../tracking/replay/library';
import { createReplaySource } from '../tracking/replay/ReplaySource';
import { LandmarkRecorder, downloadClip, validateClip } from '../tracking/replay/recorder';
import { getScript, listScripts } from '../tracking/synthetic/scripts';
import type { FrameListener, LandmarkClip, LandmarkSource, TrackingStats } from '../tracking/types';
import { createOverlayData, drawOverlay } from './overlay';
import { NEEDS, buildUi } from './ui';
import type { NeedsName } from './ui';

type Side = 'left' | 'right';

interface DebugHook {
  ready: boolean;
  error: string | null;
  frames: number;
  posedFrames: number;
  renderFrames: number;
  fistChanges: number;
  backend: string;
  sourceKind: string;
  readonly sourceFinished: boolean;
  state: InputState;
  stats: TrackingStats;
  mitt(side: Side): [number, number, number];
  shoulderHeight: number;
  recordFor(ms: number): Promise<number>;
  replayLast(): Promise<void>;
}

declare global {
  interface Window {
    __debug: DebugHook;
  }
}

interface SourceSpec {
  kind: 'camera' | 'script' | 'clip' | 'file' | 'last';
  name?: string;
  clip?: LandmarkClip;
}

interface Made {
  source: LandmarkSource;
  needs: NeedsName | null;
}

const HUD_MS = 250;
const READOUT_MS = 100;
const DISPLAY_ALLOWANCE_MS = 8;
const RAD_TO_DEG = 180 / Math.PI;

const flags = parseFlags(location.search);
const query = new URLSearchParams(location.search);

const root = document.querySelector<HTMLDivElement>('#debug-root');
if (!root) throw new Error('Missing #debug-root');

const ui = buildUi(root, listScripts(), listClips());
const overlayCtx = ui.overlay.getContext('2d');
const cropCtxLeft = ui.cropLeft.getContext('2d');
const cropCtxRight = ui.cropRight.getContext('2d');

// ---- Input pipeline ----

const state = createInputState();
const processor = new FrameProcessor(state);
const overlayData = createOverlayData();

// ---- Athlete scene ----

const fieldDay = createFieldDayScene();
const avatar = new AvatarRig();
const blob = new BlobShadow(0.55);
fieldDay.camera.position.set(0, 1.3, 3.0);
fieldDay.camera.lookAt(0, 0.95, 0);
fieldDay.scene.add(avatar.root);
fieldDay.scene.add(blob.mesh);
blob.follow(avatar.root);
let handle: RendererHandle | null = null;
const worldScratch = new Vector3();

// ---- Hook ----

const stubStats: TrackingStats = {
  inferenceMs: 0,
  trackingHz: 0,
  latencyMs: 0,
  droppedFrames: 0,
  delegate: 'none',
  inWorker: false,
};

let source: LandmarkSource | null = null;
let recorder: LandmarkRecorder | null = null;
let lastClip: LandmarkClip | null = null;

const hook: DebugHook = {
  ready: false,
  error: null,
  frames: 0,
  posedFrames: 0,
  renderFrames: 0,
  fistChanges: 0,
  backend: 'none',
  sourceKind: 'none',
  get sourceFinished(): boolean {
    const s = source as { finished?: boolean } | null;
    return s !== null && s.finished === true;
  },
  state,
  stats: stubStats,
  mitt(side: Side): [number, number, number] {
    avatar.root.updateMatrixWorld(true);
    avatar.mitts[side].getWorldPosition(worldScratch);
    return [worldScratch.x, worldScratch.y, worldScratch.z];
  },
  shoulderHeight: avatar.dimensions.shoulderHeight,
  recordFor,
  replayLast,
};
window.__debug = hook;

// ---- Frames ----

let overlayDirty = true;

const onFrame: FrameListener = (frame) => {
  hook.frames++;
  if (frame.hasPose) hook.posedFrames++;
  hook.fistChanges += processor.process(frame);
  overlayData.rawHasPose = frame.hasPose;
  overlayData.rawPose.set(frame.pose);
  overlayData.rawHandPresent[0] = frame.hands[0].present;
  overlayData.rawHandPresent[1] = frame.hands[1].present;
  overlayData.rawHands[0].set(frame.hands[0].landmarks);
  overlayData.rawHands[1].set(frame.hands[1].landmarks);
  overlayDirty = true;
};

function drawCrop(ctx: CanvasRenderingContext2D | null, bmp: ImageBitmap | null): void {
  if (!bmp) return;
  if (ctx) ctx.drawImage(bmp, 0, 0, 160, 160);
  bmp.close();
}

const onCrops = (left: ImageBitmap | null, right: ImageBitmap | null): void => {
  drawCrop(cropCtxLeft, left);
  drawCrop(cropCtxRight, right);
};

function isCameraDebug(s: LandmarkSource): s is LandmarkSource & CameraDebug {
  return 'setDebugCrops' in s && 'onDebugCrops' in s;
}

// ---- Messages ----

const PLAIN: Record<string, string> = {
  'camera-denied':
    'The camera is blocked. Click the camera icon in the address bar, allow access, then reload.',
  'camera-missing':
    'No camera was found. Plug one in, or pick a synthetic script or a recorded clip as the source.',
  'camera-in-use': 'Another app is using the camera. Close it, then reload this page.',
  'camera-low-resolution':
    'This camera is too low resolution. Tracking needs at least 640 by 360 pixels.',
  'model-load-failed':
    'The tracking models did not load. Run pnpm setup:assets, then reload this page.',
  'worker-failed': 'The tracking worker failed. Try the main thread link below.',
};

function showError(err: unknown): void {
  const code = (err as { code?: unknown }).code;
  const detail = err instanceof Error ? err.message : String(err);
  const plain = typeof code === 'string' ? PLAIN[code] : undefined;
  ui.messageText.textContent = plain ?? detail;
  ui.messageDetail.textContent = plain ? detail : '';
  ui.message.hidden = false;
  hook.error = typeof code === 'string' ? `${code}: ${detail}` : detail;
  console.info(`[debug] ${hook.error}`);
}

function clearError(): void {
  ui.message.hidden = true;
  hook.error = null;
}

// ---- Needs ----

let needsName: NeedsName = 'crops';

function needsFromQuery(): NeedsName | null {
  const v = query.get('needs');
  return v === 'pose' || v === 'crops' || v === 'hands' ? v : null;
}

function needsFromClip(clip: LandmarkClip): NeedsName {
  if (clip.needs.fullFrameHands && !clip.needs.pose) return 'hands';
  if (clip.needs.handCrops) return 'crops';
  return 'pose';
}

function applyNeedsUi(): void {
  ui.needsRadios[needsName].checked = true;
  const camera = source !== null && source.kind === 'camera';
  ui.cropsSection.hidden = !(camera && NEEDS[needsName].handCrops);
}

// ---- Source management ----

let unsubFrames: (() => void) | null = null;
let unsubCrops: (() => void) | null = null;
let generation = 0;

function teardown(): void {
  if (unsubFrames) unsubFrames();
  if (unsubCrops) unsubCrops();
  unsubFrames = null;
  unsubCrops = null;
  if (source) {
    source.video?.remove();
    source.stop();
  }
  source = null;
}

async function makeSource(spec: SourceSpec): Promise<Made> {
  switch (spec.kind) {
    case 'camera':
      return { source: await createLandmarkSource({ ...flags, source: 'camera' }), needs: null };
    case 'script': {
      const name = spec.name ?? 'idle';
      const handsOnly = (getScript(name)?.start?.handsOnly ?? 0) >= 0.5;
      return {
        source: await createLandmarkSource({ ...flags, source: 'synthetic', script: name }),
        needs: handsOnly ? 'hands' : null,
      };
    }
    case 'clip': {
      const clip = await loadClip(spec.name ?? '');
      return { source: createReplaySource(clip, { loop: true }), needs: needsFromClip(clip) };
    }
    default: {
      if (!spec.clip) throw new Error('No clip to replay.');
      return {
        source: createReplaySource(spec.clip, { loop: true }),
        needs: needsFromClip(spec.clip),
      };
    }
  }
}

async function switchSource(spec: SourceSpec, forcedNeeds?: NeedsName): Promise<void> {
  const gen = ++generation;
  if (recorder?.recording) finishRecording();
  teardown();
  processor.reset();
  overlayDirty = true;
  hook.sourceKind = 'none';
  hook.stats = stubStats;
  clearError();

  let made: Made;
  try {
    made = await makeSource(spec);
  } catch (err) {
    if (gen === generation) showError(err);
    return;
  }
  const next = made.source;
  if (gen !== generation) {
    next.stop();
    return;
  }

  if (forcedNeeds) needsName = forcedNeeds;
  else if (made.needs) needsName = made.needs;
  else if (needsName === 'hands') needsName = 'crops';

  source = next;
  hook.stats = next.stats;
  hook.sourceKind = next.kind;
  if (next.video) ui.mediaBox.insertBefore(next.video, ui.overlay);
  unsubFrames = next.subscribe(onFrame);
  if (isCameraDebug(next)) {
    unsubCrops = next.onDebugCrops(onCrops);
    next.setDebugCrops(NEEDS[needsName].handCrops);
  }
  applyNeedsUi();
  updateSourceSelect(spec);

  try {
    await next.start(NEEDS[needsName]);
  } catch (err) {
    if (gen !== generation) return;
    teardown();
    hook.sourceKind = 'none';
    hook.stats = stubStats;
    applyNeedsUi();
    showError(err);
  }
}

function updateSourceSelect(spec: SourceSpec): void {
  if (spec.kind === 'camera') ui.sourceSelect.value = 'camera';
  else if (spec.kind === 'script') ui.sourceSelect.value = `script:${spec.name ?? ''}`;
  else if (spec.kind === 'clip') ui.sourceSelect.value = `clip:${spec.name ?? ''}`;
}

function specFromSelect(value: string): SourceSpec {
  if (value.startsWith('script:')) return { kind: 'script', name: value.slice(7) };
  if (value.startsWith('clip:')) return { kind: 'clip', name: value.slice(5) };
  return { kind: 'camera' };
}

async function changeNeeds(name: NeedsName): Promise<void> {
  needsName = name;
  applyNeedsUi();
  const s = source;
  if (!s) return;
  if (isCameraDebug(s)) s.setDebugCrops(NEEDS[name].handCrops);
  try {
    await s.setNeeds(NEEDS[name]);
  } catch (err) {
    showError(err);
  }
}

// ---- Recording ----

function finishRecording(): LandmarkClip | null {
  const r = recorder;
  if (!r) return null;
  recorder = null;
  const clip = r.stop();
  downloadClip(clip);
  lastClip = clip;
  ui.replayButton.disabled = false;
  ui.recordButton.textContent = 'Record';
  ui.recordButton.classList.remove('recording');
  ui.recordStatus.textContent = `Saved ${clip.frames.length} frames`;
  return clip;
}

function startRecording(): boolean {
  if (!source) return false;
  const r = new LandmarkRecorder(source);
  r.start(`${source.kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`);
  recorder = r;
  ui.recordButton.textContent = 'Stop and save';
  ui.recordButton.classList.add('recording');
  ui.recordStatus.textContent = '0 frames';
  return true;
}

async function recordFor(ms: number): Promise<number> {
  if (recorder?.recording) finishRecording();
  if (!startRecording()) throw new Error('No source to record from.');
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  const count = recorder?.frameCount ?? 0;
  finishRecording();
  return count;
}

async function replayLast(): Promise<void> {
  if (!lastClip) throw new Error('Nothing recorded yet.');
  await switchSource({ kind: 'last', clip: lastClip });
}

// ---- Controls ----

for (const name of ['pose', 'crops', 'hands'] as const) {
  ui.needsRadios[name].addEventListener('change', () => {
    if (ui.needsRadios[name].checked) void changeNeeds(name);
  });
}

ui.sourceSelect.addEventListener('change', () => {
  void switchSource(specFromSelect(ui.sourceSelect.value));
});

ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files?.[0];
  ui.fileInput.value = '';
  if (!file) return;
  file
    .text()
    .then((text) => {
      const clip = validateClip(JSON.parse(text));
      return switchSource({ kind: 'file', clip });
    })
    .catch((err: unknown) => showError(err));
});

ui.recordButton.addEventListener('click', () => {
  if (recorder?.recording) finishRecording();
  else startRecording();
});

ui.replayButton.addEventListener('click', () => {
  void replayLast();
});

function addToggleLink(label: string, key: string, value: string): void {
  const next = new URLSearchParams(location.search);
  const on = next.get(key) === value;
  if (on) next.delete(key);
  else next.set(key, value);
  const a = document.createElement('a');
  a.className = 'pill';
  a.href = `${location.pathname}?${next.toString()}`;
  a.textContent = on ? `${label}: on` : label;
  ui.links.appendChild(a);
}

addToggleLink('WebGL renderer', 'renderer', 'webgl');
addToggleLink('Full pose model', 'pose', 'full');
addToggleLink('Main-thread tracking', 'main', '1');

// ---- Canvas sizing ----

function resizeOverlay(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(ui.overlay.clientWidth * dpr));
  const h = Math.max(1, Math.round(ui.overlay.clientHeight * dpr));
  if (ui.overlay.width !== w || ui.overlay.height !== h) {
    ui.overlay.width = w;
    ui.overlay.height = h;
    overlayDirty = true;
  }
}

function resizeAthlete(): void {
  const w = Math.max(1, ui.athleteCanvas.clientWidth);
  const h = Math.max(1, ui.athleteCanvas.clientHeight);
  fieldDay.camera.aspect = w / h;
  fieldDay.camera.updateProjectionMatrix();
  handle?.resize();
}

new ResizeObserver(resizeOverlay).observe(ui.mediaBox);
new ResizeObserver(resizeAthlete).observe(ui.athleteCanvas);
resizeOverlay();
resizeAthlete();

// ---- Render loop ----

let lastTs = performance.now();
let clock = lastTs;
let avgFrameMs = 16.7;
let fpsFrames = 0;
let appliedAspect = 16 / 9;

const loop = (ts: number): void => {
  requestAnimationFrame(loop);
  const rawDt = ts - lastTs;
  lastTs = ts;
  hook.renderFrames++;
  fpsFrames++;
  avgFrameMs += (rawDt - avgFrameMs) * 0.05;

  const s = source;
  const prevClock = clock;
  clock = s === null || s.kind === 'camera' ? ts : clock + rawDt * flags.timeScale;
  if (s) s.pump(clock);
  processor.tick(clock);

  const st = state;
  if (st.hasPose && st.tracking) {
    const span = st.t - st.tPrev;
    let alpha = span > 0 ? (clock - st.t) / span : 1;
    alpha = alpha < 0 ? 0 : alpha > 1.5 ? 1.5 : alpha;
    avatar.setUpperBodyFromPose(st.posePrev, st.pose, alpha, st.aspect);
  } else {
    avatar.releaseArm('left');
    avatar.releaseArm('right');
  }
  avatar.setMittCurl('left', st.hands.left.closed ? 1 : 0);
  avatar.setMittCurl('right', st.hands.right.closed ? 1 : 0);
  const dt = clock - prevClock;
  avatar.update(dt > 0 ? dt / 1000 : 0);
  if (handle) handle.render(fieldDay.scene, fieldDay.camera);

  if (overlayDirty && overlayCtx) {
    overlayDirty = false;
    drawOverlay(overlayCtx, ui.overlay.width, ui.overlay.height, st, overlayData);
  }
};

// ---- Throttled text ----

let hudLast = performance.now();

function fmt(v: number, digits: number): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function updateHud(): void {
  const now = performance.now();
  const fps = (fpsFrames * 1000) / Math.max(1, now - hudLast);
  fpsFrames = 0;
  hudLast = now;
  const stats = hook.stats;
  const h = ui.hud;
  h.inference.textContent = `${fmt(stats.inferenceMs, 1)} ms`;
  h.trackingHz.textContent = `${fmt(stats.trackingHz, 0)} Hz`;
  h.renderFps.textContent = `${fmt(fps, 0)} fps`;
  const latency =
    source !== null && source.kind === 'camera'
      ? stats.latencyMs + avgFrameMs + DISPLAY_ALLOWANCE_MS
      : 0;
  h.latency.textContent =
    source !== null && source.kind === 'camera' ? `${fmt(latency, 0)} ms` : '-';
  h.dropped.textContent = `${stats.droppedFrames}`;
  h.delegate.textContent = stats.delegate;
  h.thread.textContent =
    source !== null && source.kind === 'camera' ? (stats.inWorker ? 'worker' : 'main thread') : '-';
  h.backend.textContent = hook.backend;
  h.drawCalls.textContent = handle ? `${handle.drawCalls()}` : '-';
  h.source.textContent = hook.sourceKind;
  h.poseModel.textContent = source !== null && source.kind === 'camera' ? flags.pose : '-';

  const r = recorder;
  if (r?.recording) ui.recordStatus.textContent = `${r.frameCount} frames`;
}

function yesNo(v: boolean): string {
  return v ? 'yes' : 'no';
}

function updateReadout(): void {
  const st = state;
  for (const side of ['left', 'right'] as const) {
    const hand = st.hands[side];
    const refs = ui.hands[side];
    refs.present.textContent = yesNo(hand.present);
    refs.known.textContent = yesNo(hand.known);
    refs.closed.textContent = yesNo(hand.closed);
    refs.curl.textContent = fmt(hand.curl, 2);
    const arm = st.arms[side];
    const a = ui.arms[side];
    a.speed.textContent = fmt(arm.speed, 2);
    a.elbow.textContent = fmt(arm.elbowAngle * RAD_TO_DEG, 0);
    a.wristX.textContent = fmt(arm.wristX, 2);
    a.wristY.textContent = fmt(arm.wristY, 2);
  }
  ui.lean.textContent = fmt(st.lean * RAD_TO_DEG, 1);
  ui.lateral.textContent = fmt(st.lateral, 2);
  ui.shoulderWidth.textContent = fmt(st.shoulderWidth, 3);
  ui.tracking.textContent = yesNo(st.tracking);
  ui.problem.textContent = st.problem;

  if (Math.abs(st.aspect - appliedAspect) > 0.001) {
    appliedAspect = st.aspect;
    ui.mediaBox.style.aspectRatio = `${st.aspect}`;
  }
}

setInterval(updateHud, HUD_MS);
setInterval(updateReadout, READOUT_MS);

// ---- Start ----

function initialSpec(): SourceSpec {
  if (flags.source === 'synthetic') return { kind: 'script', name: flags.script ?? 'idle' };
  if (flags.source === 'replay') return { kind: 'clip', name: flags.clip ?? '' };
  return { kind: 'camera' };
}

async function initRenderer(): Promise<void> {
  try {
    const h = await createRenderer(ui.athleteCanvas, flags.renderer);
    handle = h;
    hook.backend = h.backend;
    resizeAthlete();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ui.athleteMessage.textContent = `The 3D view could not start. ${detail}`;
    ui.athleteMessage.hidden = false;
    hook.error = `renderer: ${detail}`;
  }
}

const queryNeeds = needsFromQuery();
if (queryNeeds) needsName = queryNeeds;
applyNeedsUi();
requestAnimationFrame(loop);

void Promise.all([initRenderer(), switchSource(initialSpec(), queryNeeds ?? undefined)]).then(
  () => {
    hook.ready = true;
  },
);
