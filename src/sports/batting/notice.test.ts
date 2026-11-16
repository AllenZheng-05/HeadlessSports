import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import { recognizerConfig } from '../../input/recognizers/config';
import { battingConfig } from './config';
import { HintLine, REJECTION_TEXT, rejectionHint } from './notice';
import { applyBattingRecognizer } from './recognizer';
import { BattingRound } from './round';

const cfg = { ...battingConfig };
const swingNote = { kind: 'swing', reason: 'slow' } as const;

/** A round run to the middle of its first pitch (wind-up begun, nothing swung yet). */
function roundInFlight(): { round: BattingRound; clock: number } {
  const round = new BattingRound({
    cfg,
    short: true,
    startMs: 0,
    random: mulberry32(7),
    handedness: () => 'right',
  });
  let t = 0;
  while (round.pitch === null || t < round.pitch.windupStartMs + 50) {
    t += 8;
    round.update(t);
  }
  return { round, clock: t };
}

describe('rejectionHint: a note for a swing the round took is not said', () => {
  it('says "Swing faster" for a weak swing when no swing was taken for the pitch', () => {
    const { round, clock } = roundInFlight();
    expect(round.swingT).toBe(-1);
    expect(rejectionHint(swingNote, round, clock)).toBe(REJECTION_TEXT.slow);
    expect(rejectionHint({ kind: 'swing', reason: 'lost' }, round, clock)).toBe(
      REJECTION_TEXT.lost,
    );
    expect(rejectionHint({ kind: 'swing', reason: 'steep' }, round, clock)).toBe(
      REJECTION_TEXT.steep,
    );
  });

  it('says nothing once SwingStarted was taken (a hit, or a miss by timing)', () => {
    for (const offset of [0, 200]) {
      const { round, clock } = roundInFlight();
      const p = round.pitch!;
      // Contact at the arrival (offset 0: a hit) or well off it (a miss by timing).
      const t = p.arrivalMs - cfg.batTravelMs + offset;
      const fate = round.onSwingStarted({ t, speed: 6, height: 0 }, Math.max(clock, t + 80));
      expect(fate).toBe('taken');
      expect(rejectionHint(swingNote, round, clock + 100)).toBeNull();
      expect(rejectionHint({ kind: 'swing', reason: 'lost' }, round, clock + 100)).toBeNull();
    }
  });

  it('still says it for a swing the round did not take (too early, or too late)', () => {
    const { round, clock } = roundInFlight();
    const fate = round.onSwingStarted(
      { t: round.pitch!.windupStartMs - 500, speed: 6, height: 0 },
      clock,
    );
    expect(fate).toBe('before');
    expect(rejectionHint(swingNote, round, clock)).toBe(REJECTION_TEXT.slow);
  });

  it('says nothing before the wind-up, with no round, for a throw note, or once resolved', () => {
    const { round, clock } = roundInFlight();
    expect(rejectionHint(swingNote, round, round.pitch!.windupStartMs - 1)).toBeNull();
    expect(rejectionHint(swingNote, null, clock)).toBeNull();
    expect(rejectionHint({ kind: 'throw', reason: 'slow' }, round, clock)).toBeNull();
    expect(rejectionHint(swingNote, { ...round, resolved: true }, clock)).toBeNull();
  });
});

describe('HintLine: a notice runs out', () => {
  it('shows the notice, then gives the usual hint back once its time is up', () => {
    const shown: (string | null)[] = [];
    const line = new HintLine((t) => shown.push(t), 2000);
    line.setBase('Pitch 1 of 3');
    line.say('Swing faster', 1000);
    expect(line.active(1500)).toBe(true);
    line.tick(1500);
    line.tick(2999);
    expect(shown).toEqual(['Pitch 1 of 3', 'Swing faster']);
    line.tick(3000);
    expect(line.active(3000)).toBe(false);
    expect(line.notice).toBe('');
    expect(shown).toEqual(['Pitch 1 of 3', 'Swing faster', 'Pitch 1 of 3']);
    // Set once, not every frame.
    for (let t = 3000; t < 3200; t += 8) line.tick(t);
    expect(shown).toHaveLength(3);
  });

  it('a new usual hint replaces a notice that is still up', () => {
    const show = vi.fn();
    const line = new HintLine(show, 2000);
    line.say('Swing faster', 0);
    line.setBase('Get ready. Pitch 2 of 3');
    expect(line.notice).toBe('');
    expect(line.active(10)).toBe(false);
    expect(show).toHaveBeenLastCalledWith('Get ready. Pitch 2 of 3');
    line.tick(5000);
    expect(show).toHaveBeenCalledTimes(2);
  });
});

describe('applyBattingRecognizer', () => {
  it('points the swing toward the plate for each handedness and puts it back', () => {
    const before = recognizerConfig.swing.forward;
    const restoreR = applyBattingRecognizer('right', recognizerConfig);
    expect(recognizerConfig.swing.forward).toBe(1);
    restoreR();
    expect(recognizerConfig.swing.forward).toBe(before);
    const restoreL = applyBattingRecognizer('left', recognizerConfig);
    expect(recognizerConfig.swing.forward).toBe(-1);
    restoreL();
    expect(recognizerConfig.swing.forward).toBe(before);
  });
});
