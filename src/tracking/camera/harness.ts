// Minimal page used by e2e/tracking.spec.ts: ?mode=pose|crops|hands and optional main=1.
import { gateThresholds } from '../../core/gate/thresholds';
import { runGate } from '../../core/gate/runGate';
import type { GateReport } from '../../core/gate/types';
import { createRenderer, rendererKindFromQuery } from '../../render/renderer';
import { createCameraSource } from './CameraLandmarkSource';
import type { TrackerNeeds, TrackingStats } from '../types';

interface HarnessState {
  frames: number;
  posed: number;
  handsSeen: number;
  error: string | null;
  stats: TrackingStats | null;
}

declare global {
  interface Window {
    __tracking: HarnessState;
    /** Set by mode=gate when the gate finishes (null if it could not run at all). */
    __gate?: GateReport | null;
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'pose';
const forceMainThread = params.get('main') === '1';

// mode=gate runs the device gate first; &then=pose|crops|hands then starts the camera pipeline.
const gateMode = mode === 'gate';
const cameraMode = gateMode ? (params.get('then') ?? '') : mode;
let gateText = '';

const needs: TrackerNeeds = {
  pose: cameraMode === 'pose' || cameraMode === 'crops',
  handCrops: cameraMode === 'crops',
  fullFrameHands: cameraMode === 'hands',
};

const state: HarnessState = { frames: 0, posed: 0, handsSeen: 0, error: null, stats: null };
window.__tracking = state;

const readout = document.getElementById('readout');
function render(): void {
  if (!readout) return;
  const s = state.stats;
  readout.textContent =
    gateText +
    `mode=${mode} main=${forceMainThread}\n` +
    `frames=${state.frames} posed=${state.posed} handsSeen=${state.handsSeen}\n` +
    (s
      ? `delegate=${s.delegate} inWorker=${s.inWorker} inference=${s.inferenceMs.toFixed(1)}ms ` +
        `hz=${s.trackingHz} latency=${s.latencyMs.toFixed(0)}ms dropped=${s.droppedFrames}\n`
      : '') +
    `error=${state.error ?? 'none'}`;
}

const source = createCameraSource({ forceMainThread });
state.stats = source.stats;
source.subscribe((frame) => {
  state.frames++;
  if (frame.hasPose) state.posed++;
  if (frame.hands[0].present) state.handsSeen++;
  if (frame.hands[1].present) state.handsSeen++;
});

window.addEventListener('error', (e) => {
  state.error = e.message;
});

function startCamera(): void {
  setInterval(render, 250);
  source.start(needs).then(
    () => render(),
    (err: unknown) => {
      state.error =
        err instanceof Error ? `${(err as { code?: string }).code}: ${err.message}` : String(err);
      render();
    },
  );
}

function numberParam(name: string, fallback: number): number {
  const raw = params.get(name);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function runGateMode(): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:640px;height:360px;display:block';
  document.body.appendChild(canvas);
  try {
    const renderer = await createRenderer(canvas, rendererKindFromQuery(params));
    const report = await runGate({
      renderer,
      poseModel: params.get('pose') === 'full' ? 'full' : 'lite',
      skip: false,
      mainThread: forceMainThread,
      thresholds: {
        ...gateThresholds,
        minTrackingHz: numberParam('minHz', gateThresholds.minTrackingHz),
        minRenderFps: numberParam('minFps', gateThresholds.minRenderFps),
        benchmarkMs: numberParam('ms', gateThresholds.benchmarkMs),
      },
    });
    window.__gate = report;
    gateText = `gate=${JSON.stringify(report, null, 1)}\n`;
    if (readout) readout.textContent = gateText;
    renderer.dispose();
    canvas.remove();
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    window.__gate = null;
  }
  if (cameraMode !== '') startCamera();
}

if (gateMode) void runGateMode();
else startCamera();
