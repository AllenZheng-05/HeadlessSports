import { createEmptyFrame } from '../synthetic/body';
import { SteppedSource } from '../synthetic/stepped';
import type { LandmarkClip, LandmarkFrame, LandmarkSource } from '../types';

export interface ReplaySource extends LandmarkSource {
  readonly kind: 'replay';
  /** True once a non-looping clip has delivered its last frame. */
  readonly finished: boolean;
  setClip(clip: LandmarkClip): void;
}

class ReplaySourceImpl extends SteppedSource implements ReplaySource {
  readonly kind = 'replay' as const;
  private clip: LandmarkClip;
  private readonly loop: boolean;
  private t0 = 0;
  private period = 1;

  constructor(clip: LandmarkClip, loop: boolean) {
    super(createEmptyFrame(clip.aspect));
    this.clip = clip;
    this.loop = loop;
    this.prepare();
  }

  get finished(): boolean {
    return !this.loop && this.next >= this.clip.frames.length;
  }

  setClip(clip: LandmarkClip): void {
    this.clip = clip;
    this.prepare();
    this.restart();
  }

  private prepare(): void {
    const f = this.clip.frames;
    this.t0 = f.length > 0 ? f[0].t : 0;
    if (f.length > 1) {
      // One average frame interval after the last frame before the clip wraps.
      const span = f[f.length - 1].t - this.t0;
      this.period = span + span / (f.length - 1);
    } else {
      this.period = 1000 / 30;
    }
  }

  protected dueOffset(k: number): number {
    const f = this.clip.frames;
    const n = f.length;
    if (n === 0) return Infinity;
    if (!this.loop) return k < n ? f[k].t - this.t0 : Infinity;
    const cycle = Math.floor(k / n);
    return cycle * this.period + (f[k - cycle * n].t - this.t0);
  }

  protected firstIndexAfter(rel: number): number {
    const f = this.clip.frames;
    const n = f.length;
    let cycles = 0;
    let within = rel;
    if (this.loop) {
      cycles = Math.floor(rel / this.period);
      within = rel - cycles * this.period;
    }
    let i = 0;
    while (i < n && f[i].t - this.t0 <= within) i++;
    return cycles * n + i;
  }

  protected fill(k: number, _rel: number, frame: LandmarkFrame): void {
    const f = this.clip.frames;
    const cf = f[k % f.length];
    frame.aspect = this.clip.aspect;
    if (cf.pose) {
      frame.pose.set(cf.pose);
      frame.hasPose = true;
    } else {
      frame.hasPose = false;
    }
    if (cf.world) frame.poseWorld.set(cf.world);
    for (let h = 0; h < 2; h++) {
      const src = cf.hands[h];
      const obs = frame.hands[h];
      if (src) {
        obs.landmarks.set(src);
        obs.present = true;
        obs.score = 1;
      } else {
        obs.present = false;
        obs.score = 0;
      }
    }
  }
}

export function createReplaySource(clip: LandmarkClip, options?: { loop?: boolean }): ReplaySource {
  return new ReplaySourceImpl(clip, options?.loop === true);
}
