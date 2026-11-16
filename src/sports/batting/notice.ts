import type { RejectedMotion } from '../../input/types';
import type { BattingRound } from './round';

/** What the batter is told about an arm motion that did not count as a swing. */
export const REJECTION_TEXT = {
  lost: 'I lost your arm, step back a little',
  steep: 'Swing across, not up',
  slow: 'Swing faster',
} as const;

/**
 * The hint for a rejected arm motion, or null when nothing should be said: it was not a swing, no
 * pitch is coming (before the wind-up the arms are just moving about), or the round has taken a
 * swing for this pitch. The round acts on SwingStarted, so a swing it has judged (a hit, or a miss
 * by timing) is not a swing that "did not count", whatever the peak turned out to be.
 */
export function rejectionHint(
  r: Pick<RejectedMotion, 'kind' | 'reason'>,
  round: Pick<BattingRound, 'phase' | 'pitch' | 'resolved' | 'swingT'> | null,
  nowMs: number,
): string | null {
  if (r.kind !== 'swing' || round === null || round.phase !== 'pitch') return null;
  const p = round.pitch;
  if (p === null || round.resolved || nowMs < p.windupStartMs || round.swingT >= 0) return null;
  return r.reason === 'lost'
    ? REJECTION_TEXT.lost
    : r.reason === 'steep'
      ? REJECTION_TEXT.steep
      : REJECTION_TEXT.slow;
}

/**
 * A short line over the usual hint: it is set when something is said, and handed back (once,
 * not every frame) when its time is up or the usual hint changes. Strings are only built when
 * something is said, never per frame.
 */
export class HintLine {
  /** The notice being shown, '' for none. */
  notice = '';
  private until = 0;
  private base: string | null = null;

  constructor(
    private readonly show: (text: string | null) => void,
    private readonly noticeMs: number,
  ) {}

  /** Is a notice up at game time `nowMs`? */
  active(nowMs: number): boolean {
    return this.notice !== '' && nowMs < this.until;
  }

  /** The usual hint changed: it replaces any notice. */
  setBase(text: string | null): void {
    this.base = text;
    this.notice = '';
    this.until = 0;
    this.show(text);
  }

  /** Say something for `noticeMs`. */
  say(text: string, nowMs: number): void {
    this.notice = text;
    this.until = nowMs + this.noticeMs;
    this.show(text);
  }

  /** Call every update: when a notice has run out the usual hint comes back. */
  tick(nowMs: number): void {
    if (this.notice === '' || nowMs < this.until) return;
    this.notice = '';
    this.show(this.base);
  }
}
