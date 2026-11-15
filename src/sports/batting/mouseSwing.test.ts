import { describe, expect, it } from 'vitest';
import type { MouseControl } from '../../input/debug/mouseControl';
import { battingConfig } from './config';
import { batHeightM } from './judge';
import { mouseSwingHeight, MouseSwinger } from './mouseSwing';
import { BattingRound } from './round';
import type { PitchResult } from './round';

const cfg = { ...battingConfig };

interface Fake {
  mouse: MouseControl;
  press(): void;
  swings: { power?: number; height?: number }[];
}

function fakeMouse(): Fake {
  const swings: Fake['swings'] = [];
  let presses = 0;
  const mouse = {
    mouseControl: true,
    get pointerPresses() {
      return presses;
    },
    swing(o: { power?: number; height?: number } = {}) {
      swings.push(o);
    },
  } as unknown as MouseControl;
  return {
    mouse,
    swings,
    press() {
      presses++;
    },
  };
}

/**
 * A round plus a mouse swinger, stepped at 8 ms. A click made at game time `at(pitch)` makes the
 * swing start now; the event reaches the round on the next step, as in the sport.
 */
function setup(hand: 'left' | 'right' = 'right') {
  const results: PitchResult[] = [];
  const round = new BattingRound({
    cfg,
    short: false,
    startMs: 0,
    random: () => 0.5,
    handedness: () => hand,
    hooks: { resolved: (r) => results.push(r) },
  });
  const fake = fakeMouse();
  const swinger = new MouseSwinger(fake.mouse, cfg);
  let clock = 0;
  let delivered = 0;
  const step = (): void => {
    clock += 8;
    swinger.poll(round, clock, false);
    // Deliver swings the swinger asked for, with the time of the poll.
    while (delivered < fake.swings.length) {
      const s = fake.swings[delivered++]!;
      const height = s.height ?? 0;
      round.onSwingStarted({ t: clock, speed: 11, height }, clock);
      round.onSwingPeak({ speed: 11 }, clock + 90);
    }
    round.update(clock);
  };
  const runUntil = (pred: () => boolean): void => {
    for (let i = 0; i < 20000 && !pred(); i++) step();
  };
  return { round, fake, results, step, runUntil, now: () => clock };
}

describe('mouseSwingHeight', () => {
  it('puts the bat just under the ball for each band, clamped to the swing range', () => {
    const { round, runUntil } = setup();
    runUntil(() => round.pitch !== null);
    const p = round.pitch!;
    for (const ty of [cfg.heightLow, cfg.heightMiddle, cfg.heightHigh]) {
      p.ty = ty;
      const h = mouseSwingHeight(p, cfg);
      expect(h).toBeGreaterThanOrEqual(-1);
      expect(h).toBeLessThanOrEqual(1);
      const err = batHeightM(h, cfg) - ty;
      expect(Math.abs(err)).toBeLessThanOrEqual(cfg.botBatBelowBall + 1e-9);
      expect(Math.abs(err)).toBeLessThan(cfg.missHeight);
    }
  });
});

describe('MouseSwinger', () => {
  it('swings once per press at full power with the matched height', () => {
    const t = setup();
    t.runUntil(() => t.round.pitch !== null && t.now() >= t.round.pitch.windupStartMs + 100);
    t.fake.press();
    t.step();
    expect(t.fake.swings).toHaveLength(1);
    expect(t.fake.swings[0]!.power).toBe(1);
    expect(t.fake.swings[0]!.height).toBeCloseTo(mouseSwingHeight(t.round.pitch!, cfg), 10);
    // Further clicks for the same pitch do nothing.
    t.fake.press();
    t.step();
    t.fake.press();
    t.step();
    expect(t.fake.swings).toHaveLength(1);
  });

  it('ignores a press while the pitcher is only set, and does not carry it to the pitch', () => {
    const t = setup();
    t.runUntil(() => t.round.pitch !== null);
    expect(t.now()).toBeLessThan(t.round.pitch!.windupStartMs);
    t.fake.press();
    t.step();
    expect(t.fake.swings).toHaveLength(0);
    t.runUntil(() => t.now() >= t.round.pitch!.windupStartMs + 50);
    t.step();
    expect(t.fake.swings).toHaveLength(0);
    // A later click still swings.
    t.fake.press();
    t.step();
    expect(t.fake.swings).toHaveLength(1);
  });

  it('a press during the result beat is harmless and the next pitch can still be swung at', () => {
    const t = setup();
    // Pitch 1: hit it.
    t.runUntil(
      () => t.round.pitch !== null && t.now() >= t.round.pitch.arrivalMs - cfg.batTravelMs,
    );
    t.fake.press();
    t.runUntil(() => t.results.length === 1);
    expect(t.results[0]!.kind).toBe('hit');
    // Click through the result beat and reset.
    for (let i = 0; i < 40 && t.round.phase !== 'pitch'; i++) {
      t.fake.press();
      t.step();
    }
    const swungBefore = t.fake.swings.length;
    expect(swungBefore).toBe(1);
    // Pitch 2 untouched until we click in its window.
    t.runUntil(
      () => t.round.pitch!.index === 2 && t.now() >= t.round.pitch!.arrivalMs - cfg.batTravelMs,
    );
    t.fake.press();
    t.runUntil(() => t.results.length === 2);
    expect(t.fake.swings).toHaveLength(2);
    expect(t.results[1]!.kind).toBe('hit');
  });

  it('does nothing while paused', () => {
    const round = new BattingRound({
      cfg,
      short: false,
      startMs: 0,
      random: () => 0.5,
      handedness: () => 'right',
    });
    round.update(cfg.firstPitchDelayMs + cfg.setMs + 5000);
    const fake = fakeMouse();
    const s = new MouseSwinger(fake.mouse, cfg);
    fake.press();
    s.poll(round, round.pitch!.windupStartMs + 100, true);
    expect(fake.swings).toHaveLength(0);
  });
});

describe('click timing to outcome (both hands)', () => {
  for (const hand of ['right', 'left'] as const) {
    const clickAt = (errorMs: number): PitchResult => {
      const t = setup(hand);
      t.runUntil(() => t.round.pitch !== null);
      // Contact happens at click + batTravelMs (the event is delivered at the poll step).
      t.runUntil(() => t.now() >= t.round.pitch!.arrivalMs + errorMs - cfg.batTravelMs - 8);
      t.fake.press();
      t.runUntil(() => t.results.length === 1);
      return t.results[0]!;
    };

    it(`${hand}: a well-timed click is solid contact and carries`, () => {
      const r = clickAt(0);
      expect(r.kind).toBe('hit');
      expect(['perfect', 'good']).toContain(r.judgement!.quality);
      expect(Math.abs(r.judgement!.heightError)).toBeLessThanOrEqual(cfg.botBatBelowBall + 1e-9);
      expect(r.judgement!.power).toBe(1);
      expect(r.distance).toBeGreaterThan(150);
    });

    it(`${hand}: an early click pulls, a late click pushes`, () => {
      const sg = hand === 'right' ? 1 : -1;
      const early = clickAt(-120);
      const late = clickAt(120);
      expect(early.kind).toBe('hit');
      expect(late.kind).toBe('hit');
      expect(Math.sign(early.judgement!.sprayDeg)).toBe(-sg);
      expect(Math.sign(late.judgement!.sprayDeg)).toBe(sg);
    });

    it(`${hand}: a very early or late click is a foul or a miss`, () => {
      expect(clickAt(-200).kind).toBe('foul');
      expect(clickAt(200).kind).toBe('foul');
      const late = clickAt(290);
      expect(late.kind).toBe('miss');
      expect(late.label).toBe('Too late');
      const early = clickAt(-320);
      expect(early.kind).toBe('miss');
      expect(early.label).toBe('Too early');
    });
  }
});
