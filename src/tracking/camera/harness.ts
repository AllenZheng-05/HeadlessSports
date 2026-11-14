// Minimal page used by e2e/tracking.spec.ts: ?mode=pose|crops|hands and optional main=1.
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
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'pose';
const forceMainThread = params.get('main') === '1';

const needs: TrackerNeeds = {
  pose: mode === 'pose' || mode === 'crops',
  handCrops: mode === 'crops',
  fullFrameHands: mode === 'hands',
};

const state: HarnessState = { frames: 0, posed: 0, handsSeen: 0, error: null, stats: null };
window.__tracking = state;

const readout = document.getElementById('readout');
function render(): void {
  if (!readout) return;
  const s = state.stats;
  readout.textContent =
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

setInterval(render, 250);
source.start(needs).then(
  () => render(),
  (err: unknown) => {
    state.error =
      err instanceof Error ? `${(err as { code?: string }).code}: ${err.message}` : String(err);
    render();
  },
);
