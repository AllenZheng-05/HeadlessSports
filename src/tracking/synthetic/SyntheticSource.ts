import type { LandmarkFrame, LandmarkSource } from '../types';
import { SyntheticBody, createEmptyFrame } from './body';
import type { NoiseOptions } from './body';
import { defaultControls } from './controls';
import type { BodyControls } from './controls';
import { MoveQueue } from './MoveQueue';
import { ScriptPlayer } from './script';
import type { Script } from './script';
import { SteppedSource } from './stepped';

export interface SyntheticSourceOptions {
  script: Script;
  /** Default 30. */
  fps?: number;
  /** Default 16/9. */
  aspect?: number;
  noise?: Partial<NoiseOptions>;
  startDelayMs?: number;
}

export interface SyntheticSource extends LandmarkSource {
  readonly kind: 'synthetic';
  /** Restarts script time at the next pump. */
  setScript(script: Script): void;
  /** True once a non-looping script has played to its end (the last pose keeps being emitted). */
  readonly finished: boolean;
  readonly scriptTimeMs: number;
  readonly currentLabel: string;
  /**
   * Closed-loop mode: whenever the move queue is idle at a frame, `director` is called and may
   * enqueue steps (if it enqueues nothing the pose holds). Time restarts at the next pump. `null`
   * leaves director mode (the current script, if any, restarts). `setScript` also leaves it.
   */
  setDirector(
    director: ((queue: MoveQueue, tMs: number) => void) | null,
    start?: Partial<BodyControls>,
  ): void;
  /** The director's queue, or null outside director mode. */
  readonly queue: MoveQueue | null;
}

class SyntheticSourceImpl extends SteppedSource implements SyntheticSource {
  readonly kind = 'synthetic' as const;
  finished = false;
  scriptTimeMs = 0;
  currentLabel = '';
  queue: MoveQueue | null = null;
  private director: ((queue: MoveQueue, tMs: number) => void) | null = null;
  private player: ScriptPlayer;
  private loop: boolean;
  private readonly body: SyntheticBody;
  private readonly controls: BodyControls = defaultControls();
  private readonly fps: number;

  constructor(options: SyntheticSourceOptions) {
    const aspect = options.aspect ?? 16 / 9;
    super(createEmptyFrame(aspect));
    this.fps = options.fps ?? 30;
    this.body = new SyntheticBody(aspect, options.noise);
    this.player = new ScriptPlayer(options.script);
    this.loop = options.script.loop === true;
    this.startDelayMs = options.startDelayMs ?? 0;
  }

  setDirector(
    director: ((queue: MoveQueue, tMs: number) => void) | null,
    start?: Partial<BodyControls>,
  ): void {
    this.director = director;
    this.queue = director ? new MoveQueue(start) : null;
    this.finished = false;
    this.scriptTimeMs = 0;
    this.currentLabel = '';
    this.restart();
  }

  setScript(script: Script): void {
    this.director = null;
    this.queue = null;
    this.player = new ScriptPlayer(script);
    this.loop = script.loop === true;
    this.finished = false;
    this.scriptTimeMs = 0;
    this.currentLabel = '';
    this.restart();
  }

  protected dueOffset(k: number): number {
    return (k * 1000) / this.fps;
  }

  protected firstIndexAfter(rel: number): number {
    return Math.floor((rel * this.fps) / 1000) + 1;
  }

  protected fill(_k: number, rel: number, frame: LandmarkFrame): void {
    const queue = this.queue;
    if (queue !== null && this.director !== null) {
      if (queue.idle) this.director(queue, rel);
      queue.sample(rel, this.controls);
      this.body.write(this.controls, frame);
      this.scriptTimeMs = rel;
      this.currentLabel = queue.label;
      return;
    }
    this.player.sample(rel, this.controls);
    this.body.write(this.controls, frame);
    this.scriptTimeMs = rel;
    this.currentLabel = this.player.labelAt(rel);
    if (!this.loop && rel >= this.player.durationMs) this.finished = true;
  }
}

export function createSyntheticSource(options: SyntheticSourceOptions): SyntheticSource {
  return new SyntheticSourceImpl(options);
}
