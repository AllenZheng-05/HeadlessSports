import { afterEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/random';
import { recognizerConfig } from '../../input/recognizers/config';
import { ofType } from '../../input/testing/collect';
import { runScript } from '../../input/testing/runScript';
import { TrackedInput } from '../../input/TrackedInput';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { botSwingSteps, createBattingBot } from './bot';
import { battingConfig } from './config';
import { applyBattingRecognizer } from './recognizer';
import { BattingRound } from './round';
import type { PitchResult } from './round';

const cfg = { ...battingConfig };
const SEEDS = [1, 2, 3, 4, 5];

describe.each(SEEDS)('bot swing onset, noise seed %i', (seed) => {
  it('SwingStarted lands botOnsetOffsetMs after the steps start, whatever the heights', () => {
    const heights = [-1.4, 0.1, -1.4, -0.65, 0.1, -0.65];
    const steps = [...idle(500)];
    const starts: number[] = [];
    let t = 500;
    for (const h of heights) {
      const one = botSwingSteps(cfg, h);
      starts.push(t);
      steps.push(...one, ...idle(300));
      t += one.reduce((a, x) => a + x.dur, 0) + 300;
    }
    const { events } = runScript({ name: 'onset', steps }, { seed, extraMs: 800 });
    const started = ofType(events, 'SwingStarted');
    // No premature onsets while the hands drift to a new height.
    expect(started).toHaveLength(heights.length);
    expect(ofType(events, 'SwingPeak')).toHaveLength(heights.length);
    started.forEach((e, i) => {
      expect(Math.abs(e.t - starts[i]! - cfg.botOnsetOffsetMs)).toBeLessThanOrEqual(25);
      // The reported hand height follows the height option with a steady offset.
      expect(Math.abs(e.height - heights[i]! - cfg.botHeightOffset)).toBeLessThanOrEqual(0.08);
    });
  });
});

/** The whole closed loop: bot -> synthetic source -> recognizers -> round, with no browser. */
function playShortRound(
  seed: number,
  hand: 'left' | 'right' = 'right',
): { results: PitchResult[]; round: BattingRound } {
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  const results: PitchResult[] = [];
  let clock = 0;
  const round = new BattingRound({
    cfg,
    short: true,
    startMs: 0,
    random: mulberry32(seed),
    handedness: () => hand,
    hooks: { resolved: (r) => results.push(r) },
  });
  input.on('SwingStarted', (e) => round.onSwingStarted(e, clock));
  input.on('SwingPeak', (e) => round.onSwingPeak(e, clock));
  const bot = createBattingBot({
    cfg,
    random: mulberry32(seed + 1000),
    direction: hand === 'right' ? 1 : -1,
    view: {
      pitch: () =>
        round.phase === 'pitch' && !round.resolved && round.swingT < 0 ? round.pitch : null,
      over: () => round.phase === 'ending' || round.phase === 'done',
      frameT: () => input.state.t,
    },
  });
  source.setDirector((_q, rel) => bot.next((steps) => source.queue?.enqueue(steps), rel));
  void input.start({ pose: true, handCrops: false, fullFrameHands: false });
  for (let i = 0; i < 60 * 40 && round.phase !== 'done'; i++) {
    clock = (i * 1000) / 60;
    input.update(clock);
    round.update(clock);
  }
  input.stop();
  return { results, round };
}

describe.each([1, 2, 3])('bot closed loop, short round, seed %i', (seed) => {
  it('finishes the round and hits at least once', () => {
    const { results, round } = playShortRound(seed);
    expect(round.phase).toBe('done');
    expect(results).toHaveLength(3);
    const hits = results.filter((r) => r.kind === 'hit');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(round.summary.score).toBeGreaterThan(0);
    if (process.env.BATTING_VERBOSE) {
      console.info(
        `seed ${seed}: ` +
          results
            .map(
              (r) =>
                `${r.kind} ${r.label} err=${r.judgement?.timingError.toFixed(0) ?? '-'}ms dist=${r.distance}ft`,
            )
            .join(' | '),
      );
    }
  });
});

describe.each([1, 2, 3])(
  'bot closed loop with the recognizer settings of the sport, seed %i',
  (seed) => {
    let restore = (): void => undefined;
    afterEach(() => restore());

    it.each(['right', 'left'] as const)('a %s-handed batter finishes and hits', (hand) => {
      // What the sport does on start: the swing goes toward the plate, so the load does not count.
      restore = applyBattingRecognizer(hand, recognizerConfig);
      const { results, round } = playShortRound(seed, hand);
      expect(round.phase).toBe('done');
      expect(results).toHaveLength(3);
      expect(results.filter((r) => r.kind === 'strike')).toEqual([]);
      expect(results.filter((r) => r.kind === 'hit').length).toBeGreaterThanOrEqual(1);
    });
  },
);
