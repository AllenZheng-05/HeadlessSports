import type { MouseControl } from '../../input/debug/mouseControl';
import type { BattingConfig } from './config';
import { swingInWindow } from './judge';
import type { Pitch } from './pitch';

/** The part of the round the mouse swing needs to see. */
export interface SwingView {
  readonly phase: string;
  readonly resolved: boolean;
  readonly swingT: number;
  readonly pitch: Pitch | null;
}

/**
 * The SwingStarted height (-1..1, sw above the shoulder line) that puts the bat `botBatBelowBall`
 * under the ball's centre at the plate, clamped to the range a swing can report. The mouse player
 * never aims: contact quality depends only on timing.
 */
export function mouseSwingHeight(pitch: Pitch, cfg: BattingConfig): number {
  const bat = pitch.ty - cfg.botBatBelowBall;
  const sw = (bat - cfg.shoulderHeightM + cfg.batDrop) / cfg.swToMetres;
  return sw < -1 ? -1 : sw > 1 ? 1 : sw;
}

/** Can a click swing at this pitch right now? From the wind-up to the end of the late window, once. */
export function canMouseSwing(view: SwingView, clock: number, cfg: BattingConfig): boolean {
  const p = view.pitch;
  return (
    p !== null &&
    view.phase === 'pitch' &&
    !view.resolved &&
    view.swingT < 0 &&
    swingInWindow(p, clock, cfg)
  );
}

/**
 * One click, one swing: a full-power swing whose height is matched to the incoming pitch. Clicks
 * outside a pitch's swing window are ignored (they are never held over for the next pitch).
 */
export class MouseSwinger {
  private seen: number;
  private swungFor = 0;

  constructor(
    private readonly mouse: MouseControl,
    private readonly cfg: BattingConfig,
  ) {
    this.seen = mouse.pointerPresses;
  }

  /** Call once per fixed update. Allocation-free. */
  poll(view: SwingView, clock: number, paused: boolean): void {
    const presses = this.mouse.pointerPresses;
    if (presses === this.seen) return;
    this.seen = presses;
    if (paused) return;
    const p = view.pitch;
    if (p === null || p.index === this.swungFor || !canMouseSwing(view, clock, this.cfg)) return;
    this.swungFor = p.index;
    this.mouse.swing({ power: 1, height: mouseSwingHeight(p, this.cfg) });
  }
}
