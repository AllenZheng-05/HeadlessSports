import { CONTROL_KEYS, defaultControls } from './controls';
import type { BodyControls } from './controls';
import { applyEase } from './script';
import type { Ease, ScriptStep } from './script';

const K = CONTROL_KEYS.length;
const CAPACITY = 256;

/**
 * A run-time queue of motion steps. Each step moves the named controls from their values at the
 * moment the step begins to its targets. Time is absolute and monotonic; a step queued while the
 * queue is idle begins at the next `sample`, a step queued behind another begins where it ends.
 * `sample` allocates nothing.
 */
export class MoveQueue {
  // Ring of step slots.
  private readonly durs = new Float64Array(CAPACITY);
  private readonly targets = new Float64Array(CAPACITY * K);
  private readonly masks = new Uint8Array(CAPACITY * K);
  private readonly eases: Ease[] = new Array<Ease>(CAPACITY).fill('smooth');
  private readonly labels: string[] = new Array<string>(CAPACITY).fill('');
  private head = 0;
  private count = 0;

  /** The held pose: the last sampled controls (target values once a step completes). */
  private readonly cur = new Float64Array(K);
  private readonly from = new Float64Array(K);
  private active = false;
  private stepStart = 0;
  /** Where the next step in a chain begins (the previous step's end). */
  private cursor = 0;
  /** The queue drained (or was reset) since a step last ran: the next step starts at the next sample time. */
  private fresh = true;
  private lastT = 0;
  /** Total duration of queued steps, excluding the one at the head. */
  private queuedMs = 0;

  constructor(start?: Partial<BodyControls>) {
    this.reset(start);
  }

  reset(start?: Partial<BodyControls>): void {
    const d = defaultControls();
    if (start) Object.assign(d, start);
    for (let k = 0; k < K; k++) this.cur[k] = d[CONTROL_KEYS[k]];
    this.dropAll();
  }

  clear(): void {
    this.dropAll();
  }

  private dropAll(): void {
    this.head = 0;
    this.count = 0;
    this.active = false;
    this.fresh = true;
    this.queuedMs = 0;
  }

  enqueue(steps: readonly ScriptStep[]): void {
    if (this.count + steps.length > CAPACITY) {
      throw new Error(
        `MoveQueue is full (capacity ${CAPACITY}); cannot enqueue ${steps.length} steps`,
      );
    }
    for (const step of steps) {
      if (!(step.dur > 0)) throw new Error(`MoveQueue step "${step.label ?? ''}" has dur <= 0`);
    }
    for (const step of steps) {
      const slot = (this.head + this.count) % CAPACITY;
      this.durs[slot] = step.dur;
      this.eases[slot] = step.ease ?? 'smooth';
      this.labels[slot] = step.label ?? '';
      const base = slot * K;
      for (let k = 0; k < K; k++) {
        const target = step.to?.[CONTROL_KEYS[k]];
        if (target !== undefined) {
          this.targets[base + k] = target;
          this.masks[base + k] = 1;
        } else {
          this.masks[base + k] = 0;
        }
      }
      if (this.count > 0) this.queuedMs += step.dur;
      this.count++;
    }
  }

  get idle(): boolean {
    return this.count === 0;
  }

  get label(): string {
    return this.count > 0 ? this.labels[this.head] : '';
  }

  get pendingMs(): number {
    if (this.count === 0) return 0;
    const headDur = this.durs[this.head];
    const headLeft = this.active
      ? Math.max(0, Math.min(headDur, this.stepStart + headDur - this.lastT))
      : headDur;
    return headLeft + this.queuedMs;
  }

  sample(tMs: number, out: BodyControls): void {
    if (this.count > 0 && !this.active && this.fresh) this.cursor = tMs;
    this.lastT = tMs;
    while (this.count > 0) {
      const slot = this.head;
      if (!this.active) {
        this.from.set(this.cur);
        this.stepStart = this.cursor;
        this.active = true;
        this.fresh = false;
      }
      const dur = this.durs[slot];
      const end = this.stepStart + dur;
      const base = slot * K;
      if (tMs >= end) {
        for (let k = 0; k < K; k++) {
          if (this.masks[base + k] === 1) this.cur[k] = this.targets[base + k];
        }
        this.cursor = end;
        this.active = false;
        this.head = (slot + 1) % CAPACITY;
        this.count--;
        if (this.count === 0) {
          this.fresh = true;
          this.queuedMs = 0;
        } else {
          this.queuedMs -= this.durs[this.head];
        }
        continue;
      }
      const p = tMs <= this.stepStart ? 0 : (tMs - this.stepStart) / dur;
      const e = applyEase(this.eases[slot], p);
      for (let k = 0; k < K; k++) {
        const a = this.from[k];
        this.cur[k] = this.masks[base + k] === 1 ? a + (this.targets[base + k] - a) * e : a;
      }
      break;
    }
    for (let k = 0; k < K; k++) out[CONTROL_KEYS[k]] = this.cur[k];
  }
}
