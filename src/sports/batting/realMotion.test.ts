// PLACEHOLDER: synthetic motion; replace with real recordings in tests/recordings/
//
// Batting on motion a real batter makes: standing side-on to the camera (shoulders overlapped, the
// far arm faint), a short 2D swing, the wrists blurring at the peak, and realistic jitter. The
// closed loop is the bot's (it times the swing from the pitch's arrival) but it swings the side-on
// way. The swing must be seen, timed, and judged as a hit.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/random';
import { recognizerConfig } from '../../input/recognizers/config';
import { REAL_SIGMA, play } from '../../input/recognizers/profileHarness';
import { ofType } from '../../input/testing/collect';
import { runScript } from '../../input/testing/runScript';
import { TrackedInput } from '../../input/TrackedInput';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { sideOnSwing, turnToStance } from '../../tracking/synthetic/scripts/profile';
import { battingConfig } from './config';
import { applyBattingRecognizer } from './recognizer';
import { BattingRound } from './round';
import type { PitchResult } from './round';

const cfg = { ...battingConfig };
const FRAME_MS = 1000 / 30;
/** Seconds-long pitch loop; a short round has three pitches. */
const SEEDS = [1, 2, 3];

// What the sport does on start: the swing goes toward the plate (a right-handed batter here).
let restore = (): void => undefined;
beforeEach(() => {
  restore = applyBattingRecognizer('right', recognizerConfig);
});
afterEach(() => {
  restore();
});

/** SwingStarted.t minus the start of the swing steps, measured on the same script. */
function measureOffset(seed: number, reach: number): number {
  const lead = [...idle(500), ...turnToStance({ near: 'left' })];
  const start = lead.reduce((a, x) => a + x.dur, 0);
  const { events } = runScript(
    { name: 'o', steps: [...lead, ...sideOnSwing({ power: 0.6, reach })] },
    { seed, noise: REAL_SIGMA, extraMs: 800 },
  );
  const started = ofType(events, 'SwingStarted');
  expect(started).toHaveLength(1);
  return started[0]!.t - start;
}

function playSideOnRound(seed: number, reach: number): PitchResult[] {
  const offset = measureOffset(seed, reach);
  const source = createSyntheticSource({
    script: { name: 'side', steps: idle(100) },
    noise: { seed, sigma: REAL_SIGMA },
  });
  const input = new TrackedInput(source);
  const results: PitchResult[] = [];
  let clock = 0;
  const round = new BattingRound({
    cfg,
    short: true,
    startMs: 0,
    random: mulberry32(seed),
    handedness: () => 'right',
    hooks: { resolved: (r) => results.push(r) },
  });
  input.on('SwingStarted', (e) => round.onSwingStarted(e, clock));
  input.on('SwingPeak', (e) => round.onSwingPeak(e, clock));
  let stanced = false;
  let swungFor = 0;
  source.setDirector((q, rel, frameT) => {
    if (!stanced) {
      stanced = true;
      q.enqueue(turnToStance({ near: 'left' }));
      return;
    }
    if (!(frameT > 0) || round.phase === 'ending' || round.phase === 'done') {
      q.enqueue(idle(100));
      return;
    }
    const p = round.phase === 'pitch' && !round.resolved && round.swingT < 0 ? round.pitch : null;
    if (p === null || p.index === swungFor) {
      q.enqueue(idle(100));
      return;
    }
    const startAt = p.arrivalMs - cfg.batTravelMs - offset;
    const remaining = startAt - (frameT + FRAME_MS);
    if (remaining > 25) {
      q.enqueue(idle(Math.max(1, remaining - 50)));
      return;
    }
    swungFor = p.index;
    if (remaining < -150) {
      q.enqueue(idle(100));
      return;
    }
    q.enqueue(sideOnSwing({ power: 0.6, reach }));
    void rel;
  });
  void input.start({ pose: true, handCrops: false, fullFrameHands: false });
  for (let i = 0; i < 60 * 45 && round.phase !== 'done'; i++) {
    clock = (i * 1000) / 60;
    input.update(clock);
    round.update(clock);
  }
  input.stop();
  expect(round.phase).toBe('done');
  return results;
}

describe.each(SEEDS)('side-on batting closed loop, seed %i', (seed) => {
  it('sees, times and judges a full side-on swing', () => {
    const results = playSideOnRound(seed, 0.9);
    expect(results).toHaveLength(3);
    // Every pitch was swung at (none is a strike), and the swing is on time often enough to hit.
    expect(results.filter((r) => r.kind === 'strike')).toEqual([]);
    expect(results.filter((r) => r.kind === 'hit').length).toBeGreaterThanOrEqual(2);
  });

  it('sees a short swing with a small 2D reach as well', () => {
    const results = playSideOnRound(seed, 0.6);
    expect(results.filter((r) => r.kind === 'strike')).toEqual([]);
    expect(results.filter((r) => r.kind === 'hit').length).toBeGreaterThanOrEqual(1);
  });
});

describe('the delay between a stamp of a swing and its announcement', () => {
  // SwingStarted is stamped at the true onset (the round judges by that stamp plus batTravelMs) but
  // is announced a frame or two later, once the onset is confirmed. Late events are fine for the
  // round as long as they land before a pitch with no swing is called a strike.
  it('is at most about 150 ms, inside the event allowance of the round', () => {
    let worst = 0;
    let count = 0;
    for (const power of [0.2, 0.4, 0.6, 0.8, 1]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        let now = 0;
        let delay = -1;
        const lead = [...idle(500), ...turnToStance({ near: 'left' })];
        play({ name: 'd', steps: [...lead, ...sideOnSwing({ power })] }, seed, {
          setup: (input) => {
            input.on('SwingStarted', (e) => {
              delay = now - e.t;
            });
          },
          onFrame: (_state, t) => {
            now = t;
          },
        });
        expect(delay).toBeGreaterThan(0);
        worst = Math.max(worst, delay);
        count++;
      }
    }
    expect(count).toBe(25);
    // The estimator lag (about 66 ms), plus at most confirmMs and a frame.
    expect(worst).toBeLessThanOrEqual(66 + recognizerConfig.swing.confirmMs + 34);
    // A swing stamped at the latest accepted moment (arrival + lateWindowMs) is still announced
    // before the pitch is called a strike (arrival + lateWindowMs + eventDelayAllowanceMs).
    expect(worst).toBeLessThan(cfg.eventDelayAllowanceMs);
  });
});
