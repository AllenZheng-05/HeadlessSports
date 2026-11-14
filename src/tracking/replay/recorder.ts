import { createSyntheticSource } from '../synthetic/SyntheticSource';
import { ScriptPlayer } from '../synthetic/script';
import type { Script } from '../synthetic/script';
import { HAND_COUNT, HAND_STRIDE, POSE_COUNT, POSE_STRIDE, WORLD_STRIDE } from '../types';
import type {
  ClipFrame,
  LandmarkClip,
  LandmarkFrame,
  LandmarkSource,
  TrackerNeeds,
} from '../types';

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function copyRounded(src: Float32Array): number[] {
  const out = new Array<number>(src.length);
  for (let i = 0; i < src.length; i++) out[i] = round4(src[i]);
  return out;
}

export class LandmarkRecorder {
  private readonly source: LandmarkSource;
  private unsubscribe: (() => void) | null = null;
  private frames: ClipFrame[] = [];
  private firstT = 0;
  private aspect = 16 / 9;
  private clipName = '';
  private anyPose = false;

  constructor(source: LandmarkSource) {
    this.source = source;
  }

  get recording(): boolean {
    return this.unsubscribe !== null;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  start(name: string): void {
    if (this.unsubscribe) this.unsubscribe();
    this.clipName = name;
    this.frames = [];
    this.anyPose = false;
    this.unsubscribe = this.source.subscribe((f) => this.capture(f));
  }

  private capture(f: LandmarkFrame): void {
    if (this.frames.length === 0) {
      this.firstT = f.t;
      this.aspect = f.aspect;
    }
    const left = f.hands[0].present ? copyRounded(f.hands[0].landmarks) : null;
    const right = f.hands[1].present ? copyRounded(f.hands[1].landmarks) : null;
    if (f.hasPose) this.anyPose = true;
    this.frames.push({
      t: round4(f.t - this.firstT),
      pose: f.hasPose ? copyRounded(f.pose) : null,
      world: f.hasPose ? copyRounded(f.poseWorld) : null,
      hands: [left, right],
    });
  }

  /**
   * Stops recording and returns the clip. `needs` is inferred from what was seen: pose if any frame
   * had one, hand crops if hands came with a pose, full-frame hands if hands came without.
   */
  stop(): LandmarkClip {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    let handCrops = false;
    let fullFrameHands = false;
    for (const fr of this.frames) {
      if (!fr.hands[0] && !fr.hands[1]) continue;
      if (fr.pose) handCrops = true;
      else fullFrameHands = true;
    }
    const needs: TrackerNeeds = { pose: this.anyPose, handCrops, fullFrameHands };
    return {
      version: 1,
      name: this.clipName,
      createdAt: new Date().toISOString(),
      origin: this.source.kind === 'camera' ? 'camera' : 'synthetic',
      aspect: this.aspect,
      needs,
      frames: this.frames,
    };
  }
}

function fail(message: string): never {
  throw new Error(`Invalid landmark clip: ${message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkNumbers(v: unknown, length: number, where: string): void {
  if (!Array.isArray(v)) fail(`${where} must be an array`);
  if (v.length !== length) fail(`${where} must have ${length} numbers, got ${v.length}`);
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) {
      fail(`${where}[${i}] is not a finite number`);
    }
  }
}

/** Throws a clear Error when the value is not a well-formed clip. */
export function validateClip(value: unknown): LandmarkClip {
  if (!isRecord(value)) fail('not an object');
  if (value.version !== 1) fail(`unsupported version ${String(value.version)}`);
  if (typeof value.name !== 'string') fail('name must be a string');
  if (typeof value.createdAt !== 'string') fail('createdAt must be a string');
  if (value.origin !== 'camera' && value.origin !== 'synthetic') {
    fail('origin must be "camera" or "synthetic"');
  }
  if (typeof value.aspect !== 'number' || !(value.aspect > 0) || !Number.isFinite(value.aspect)) {
    fail('aspect must be a positive number');
  }
  const needs = value.needs;
  if (
    !isRecord(needs) ||
    typeof needs.pose !== 'boolean' ||
    typeof needs.handCrops !== 'boolean' ||
    typeof needs.fullFrameHands !== 'boolean'
  ) {
    fail('needs must have boolean pose, handCrops and fullFrameHands');
  }
  if (!Array.isArray(value.frames)) fail('frames must be an array');
  let prev = -Infinity;
  for (let i = 0; i < value.frames.length; i++) {
    const fr: unknown = value.frames[i];
    const where = `frames[${i}]`;
    if (!isRecord(fr)) fail(`${where} is not an object`);
    if (typeof fr.t !== 'number' || !Number.isFinite(fr.t)) {
      fail(`${where}.t is not a finite number`);
    }
    if (fr.t < prev) fail(`${where}.t goes backwards (${fr.t} after ${prev})`);
    prev = fr.t;
    if (fr.pose !== null) checkNumbers(fr.pose, POSE_COUNT * POSE_STRIDE, `${where}.pose`);
    if (fr.world !== null) checkNumbers(fr.world, POSE_COUNT * WORLD_STRIDE, `${where}.world`);
    if (!Array.isArray(fr.hands) || fr.hands.length !== 2) {
      fail(`${where}.hands must have 2 entries`);
    }
    for (let h = 0; h < 2; h++) {
      const hand: unknown = fr.hands[h];
      if (hand !== null) checkNumbers(hand, HAND_COUNT * HAND_STRIDE, `${where}.hands[${h}]`);
    }
  }
  return value as unknown as LandmarkClip;
}

/** Browser only: save the clip as `<name>.json`. */
export function downloadClip(clip: LandmarkClip): void {
  const blob = new Blob([JSON.stringify(clip)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${clip.name.replace(/[^\w.-]+/g, '_') || 'clip'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Run a script through a synthetic source offline (no timers) and return it as a clip marked origin 'synthetic'. */
export function scriptToClip(
  script: Script,
  options: { fps?: number; seed?: number; aspect?: number } = {},
): LandmarkClip {
  const fps = options.fps ?? 30;
  const source = createSyntheticSource({
    script,
    fps,
    aspect: options.aspect,
    noise: { seed: options.seed ?? 1 },
  });
  const recorder = new LandmarkRecorder(source);
  void source.start({ pose: true, handCrops: true, fullFrameHands: true });
  recorder.start(script.name);
  // One pass through the script; looping scripts are cut at one period.
  const duration = new ScriptPlayer(script).durationMs;
  for (let k = 0; (k * 1000) / fps <= duration; k++) source.pump((k * 1000) / fps);
  source.stop();
  return recorder.stop();
}
