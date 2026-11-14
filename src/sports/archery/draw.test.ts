import { describe, expect, it } from 'vitest';
import { archeryConfig } from './config';
import { DrawMachine, StepEvent } from './draw';
import type { DrawSample, StepEventValue } from './draw';

const cfg = { ...archeryConfig };
const DT = 1 / 120;

/** Drives a machine at 120 Hz with a mutable sample and a running clock (ms). */
class Rig {
  readonly m = new DrawMachine(cfg);
  now = 0;
  readonly s: DrawSample = {
    valid: true,
    bowUp: true,
    dist: 0.7,
    present: true,
    known: true,
    closed: false,
    yaw: 0,
    pitch: 0,
  };
  /** Every non-None event, in order. */
  readonly events: StepEventValue[] = [];

  run(ms: number, patch: Partial<DrawSample> = {}): StepEventValue {
    Object.assign(this.s, patch);
    let last: StepEventValue = StepEvent.None;
    const steps = Math.round(ms / (DT * 1000));
    for (let i = 0; i < steps; i++) {
      this.now += DT * 1000;
      const ev = this.m.step(DT, this.now, this.s);
      if (ev !== StepEvent.None) {
        this.events.push(ev);
        last = ev;
      }
    }
    return last;
  }

  /** Close the fist near the raised bow hand: the nock. */
  nock(): void {
    this.run(100, { closed: false, dist: 0.7, bowUp: true });
    this.m.noteClosed();
    this.run(50, { closed: true });
  }

  /** Pull to full draw and settle. */
  pull(dist = 2.2): void {
    this.run(700, { dist });
  }
}

describe('nock', () => {
  it('needs the bow arm up, a closing fist and the hands together', () => {
    const r = new Rig();
    r.run(200);
    expect(r.m.phase).toBe('ready');
    expect(r.m.hint).toBe('nock');

    // Fist closes with the bow arm down: no nock.
    r.run(100, { closed: false, bowUp: false });
    expect(r.m.hint).toBe('raise');
    r.m.noteClosed();
    r.run(200, { closed: true, bowUp: false });
    expect(r.m.phase).toBe('ready');

    // Fist closes with the hands apart: no nock.
    r.run(100, { closed: false, bowUp: true, dist: 2.6 });
    r.m.noteClosed();
    r.run(200, { closed: true, dist: 2.6 });
    expect(r.m.phase).toBe('ready');

    // Hands together, bow up, fist closes: nock.
    r.run(100, { closed: false, dist: 0.7 });
    r.m.noteClosed();
    expect(r.run(50, { closed: true })).toBe(StepEvent.Nock);
    expect(r.m.phase).toBe('drawing');
  });

  it('accepts a fist that closed just before the hands arrived, but not an old one', () => {
    const r = new Rig();
    r.run(100, { closed: false, dist: 2.6 });
    r.m.noteClosed();
    r.run(50, { closed: true, dist: 2.6 });
    expect(r.run(100, { dist: 0.7 })).toBe(StepEvent.Nock);

    const r2 = new Rig();
    r2.run(100, { closed: false, dist: 2.6 });
    r2.m.noteClosed();
    r2.run(cfg.nockGraceMs + 300, { closed: true, dist: 2.6 });
    r2.run(100, { dist: 0.7 });
    expect(r2.m.phase).toBe('ready');
  });

  it('sees a fist that closes through the state alone, without an event', () => {
    const r = new Rig();
    r.run(100, { closed: false });
    expect(r.run(100, { closed: true })).toBe(StepEvent.Nock);
  });

  it('does not nock from an unknown fist', () => {
    const r = new Rig();
    r.run(100, { known: false, closed: false });
    r.m.noteClosed();
    r.run(300, { known: false, closed: true });
    expect(r.m.phase).toBe('ready');
  });
});

describe('forgiving nock (wide distance, hysteresis, no fist)', () => {
  it('nocks with the hands up to the wider nock distance apart', () => {
    expect(cfg.nockDistance).toBeGreaterThanOrEqual(1.8);
    const r = new Rig();
    r.run(100, { closed: false, dist: cfg.nockDistance - 0.1 });
    r.m.noteClosed();
    expect(r.run(50, { closed: true })).toBe(StepEvent.Nock);
    // Just beyond it does not.
    const r2 = new Rig();
    r2.run(100, { closed: false, dist: cfg.nockDistance + 0.1 });
    r2.m.noteClosed();
    r2.run(200, { closed: true });
    expect(r2.m.phase).toBe('ready');
  });

  it('does not nock with the hands at rest by the sides', () => {
    const r = new Rig();
    // Wrists hang about 1 sw apart, well below the bow-arm height: arm not up.
    r.run(100, { bowUp: false, dist: 1.0, closed: false });
    r.m.noteClosed();
    r.run(1500, { bowUp: false, dist: 1.0, closed: true });
    expect(r.m.phase).toBe('ready');
    // Arms swinging apart and together at rest never pull-nock either.
    for (let d = 1.0; d < 2.4; d += 2 * DT) r.run(DT * 1000, { bowUp: false, dist: d });
    r.run(500, { bowUp: false, dist: 2.4 });
    expect(r.m.phase).toBe('ready');
  });

  it('keeps "together" until the keep distance (hysteresis)', () => {
    const r = new Rig();
    r.run(100, { closed: false, dist: cfg.nockDistance - 0.1 });
    // Drift past the nock distance but inside the keep distance, then the fist closes.
    r.run(100, { closed: false, dist: cfg.nockDistance + 0.2 });
    r.m.noteClosed();
    expect(r.run(50, { closed: true })).toBe(StepEvent.Nock);
    // Beyond the keep distance it is dropped.
    const r2 = new Rig();
    r2.run(100, { closed: false, dist: cfg.nockDistance - 0.1 });
    r2.run(100, { closed: false, dist: cfg.nockKeepDistance + 0.1 });
    r2.m.noteClosed();
    r2.run(50, { closed: true });
    expect(r2.m.phase).toBe('ready');
  });

  it('nocks with an open hand when the hands are together and the draw hand pulls back', () => {
    const r = new Rig();
    r.run(800, { closed: false, dist: 0.6 });
    expect(r.m.phase).toBe('ready');
    let ev: StepEventValue = StepEvent.None;
    for (let d = 0.6; d < 1.8 && ev === StepEvent.None; d += 1.5 * DT) {
      ev = r.run(DT * 1000, { closed: false, dist: d });
    }
    expect(ev).toBe(StepEvent.Nock);
    expect(r.m.phase).toBe('drawing');
    expect(r.m.autoNock).toBe(false);
  });

  it('a slow drift apart, or a raised arm, does not pull-nock', () => {
    const r = new Rig();
    r.run(800, { closed: false, dist: 0.6 });
    for (let d = 0.6; d < 2.2; d += 0.3 * DT) r.run(DT * 1000, { closed: false, dist: d });
    expect(r.m.phase).toBe('ready');
    // The bow arm only just came up: not stable yet.
    const r2 = new Rig();
    r2.run(100, { bowUp: false, dist: 0.6 });
    for (let d = 0.6; d < 1.8; d += 4 * DT) r2.run(DT * 1000, { bowUp: true, dist: d });
    expect(r2.m.phase).toBe('ready');
  });

  it('shoots an open-hand nock with a quick return, and a draw starts from the nock distance', () => {
    const r = new Rig();
    r.run(800, { closed: false, dist: 0.6 });
    for (let d = 0.6; d < 1.8; d += 1.5 * DT) r.run(DT * 1000, { closed: false, dist: d });
    r.run(800, { closed: false, dist: 2.4 });
    expect(r.m.draw).toBeGreaterThan(0.95);
    let ev: StepEventValue = StepEvent.None;
    let dist = 2.4;
    for (let i = 0; i < 60 && ev === StepEvent.None; i++) {
      dist -= 5 * DT;
      ev = r.run(DT * 1000, { closed: false, dist });
    }
    expect(ev).toBe(StepEvent.Shot);
  });

  it('a wide nock still reaches a full draw once the hands come together first', () => {
    const r = new Rig();
    r.run(100, { closed: false, dist: 1.7 });
    r.m.noteClosed();
    r.run(50, { closed: true });
    expect(r.m.phase).toBe('drawing');
    r.run(300, { dist: 0.7 });
    r.run(700, { dist: 0.7 + cfg.drawFull - cfg.drawStart + 0.05 });
    expect(r.m.draw).toBeGreaterThan(0.95);
  });

  it('keeps the arrow nocked through a sagging bow arm and a long hand loss', () => {
    const r = new Rig();
    r.nock();
    r.pull();
    // bowUp is decided by the caller with the looser hold limits; the machine waits bowDropMs.
    expect(cfg.bowHoldMinReach).toBeLessThan(cfg.bowMinReach);
    expect(cfg.bowHoldMaxDrop).toBeGreaterThan(cfg.bowMaxDrop);
    r.run(cfg.lostHandCancelMs - 300, { present: false });
    expect(r.m.phase).toBe('drawing');
  });
});

describe('release', () => {
  it('shoots at or above the minimum draw with the draw and aim at that moment', () => {
    const r = new Rig();
    r.nock();
    r.run(100, { yaw: 0.05, pitch: 0.02 });
    r.pull(2.2);
    expect(r.m.draw).toBeGreaterThan(0.95);
    expect(r.m.hint).toBe('aim');
    r.m.noteOpened(r.now);
    expect(r.run(20, { closed: false })).toBe(StepEvent.Shot);
    expect(r.m.phase).toBe('locked');
    expect(r.m.shot.draw).toBeGreaterThan(0.95);
    expect(r.m.shot.yaw).toBeCloseTo(0.05);
    expect(r.m.shot.pitch).toBeCloseTo(0.02);
  });

  it('puts the arrow back below the minimum draw and says to pull further', () => {
    const r = new Rig();
    r.nock();
    r.run(500, { dist: cfg.drawStart + 0.1 });
    expect(r.m.draw).toBeLessThan(cfg.minDraw);
    expect(r.m.hint).toBe('pull');
    r.m.noteOpened(r.now);
    expect(r.run(20, { closed: false })).toBe(StepEvent.Unnock);
    expect(r.m.phase).toBe('ready');
    expect(r.m.hint).toBe('further');
    r.run(cfg.furtherHintMs + 200);
    expect(r.m.hint).not.toBe('further');
  });

  it('uses the sample from before the open event, not the hand drag that follows it', () => {
    const r = new Rig();
    r.nock();
    r.pull(2.2);
    r.run(200, { yaw: 0.1 });
    const dragStart = r.now;
    // The hand opens at dragStart and drags the aim; the debounced event arrives 100 ms late.
    r.run(100, { yaw: 0.2, dist: 1.0 });
    r.m.noteOpened(dragStart + 30);
    expect(r.run(20, { closed: false })).toBe(StepEvent.Shot);
    expect(r.m.shot.yaw).toBeCloseTo(0.1);
    expect(r.m.shot.draw).toBeGreaterThan(0.9);
  });

  it('keeps the shot values as the machine locks, and ignores events while locked', () => {
    const r = new Rig();
    r.nock();
    r.pull();
    r.m.noteOpened(r.now);
    r.run(20, { closed: false });
    const draw = r.m.shot.draw;
    r.m.noteClosed();
    r.run(500, { closed: true, dist: 0.7 });
    expect(r.m.phase).toBe('locked');
    expect(r.m.shot.draw).toBe(draw);
    r.m.unlock();
    expect(r.m.phase).toBe('ready');
    // A fist that was already closed before unlock does not nock by itself.
    r.run(300, { closed: true });
    expect(r.m.phase).toBe('ready');
  });

  it('holds the sway clock only while at full draw', () => {
    const r = new Rig();
    r.nock();
    r.run(1000, { dist: 1.0 });
    expect(r.m.holdFullS).toBe(0);
    r.run(1000, { dist: 2.2 });
    expect(r.m.holdFullS).toBeGreaterThan(0.4);
  });
});

describe('never guess', () => {
  it('holds the draw when the hand is lost, then cancels', () => {
    const r = new Rig();
    r.nock();
    r.pull();
    r.run(500, { present: false });
    expect(r.m.phase).toBe('drawing');
    expect(r.m.hint).toBe('lost');
    // An open event while the hand is not tracked does not release.
    r.m.noteOpened(r.now);
    r.run(100, { present: false });
    expect(r.m.phase).toBe('drawing');
    expect(r.events).not.toContain(StepEvent.Shot);
    expect(r.run(cfg.lostHandCancelMs, { present: false })).toBe(StepEvent.Cancel);
    expect(r.m.phase).toBe('ready');
  });

  it('forgives a hand that comes back in time', () => {
    const r = new Rig();
    r.nock();
    r.pull();
    r.run(cfg.lostHandCancelMs - 600, { present: false });
    r.run(100, { present: true });
    r.run(cfg.lostHandCancelMs - 600, { present: false });
    expect(r.m.phase).toBe('drawing');
    expect(r.m.hint).toBe('lost');
    r.run(100, { present: true });
    expect(r.m.hint).toBe('aim');
  });

  it('puts the arrow back when the bow arm drops for long enough', () => {
    const r = new Rig();
    r.nock();
    r.pull();
    r.run(cfg.bowDropMs - 150, { bowUp: false });
    expect(r.m.phase).toBe('drawing');
    r.run(100, { bowUp: true });
    r.run(cfg.bowDropMs - 150, { bowUp: false });
    expect(r.m.phase).toBe('drawing');
    expect(r.run(300, { bowUp: false })).toBe(StepEvent.Cancel);
    expect(r.m.phase).toBe('ready');
    expect(r.events).not.toContain(StepEvent.Shot);
  });
});

describe('fallback for a fist that is never seen', () => {
  const blind: Partial<DrawSample> = { known: false, closed: false };

  it('nocks by itself after the hands stay together long enough', () => {
    const r = new Rig();
    r.run(cfg.fistFallbackMs - 500, blind);
    expect(r.m.phase).toBe('ready');
    expect(r.run(800, blind)).toBe(StepEvent.AutoNock);
    expect(r.m.phase).toBe('drawing');
    expect(r.m.autoNock).toBe(true);
  });

  it('restarts the wait when the hands come apart or the bow arm drops', () => {
    const r = new Rig();
    r.run(1000, blind);
    // The hands creep apart (slower than a deliberate pull, so no pull-nock) past the keep distance.
    for (let d = 0.7; d <= cfg.nockKeepDistance + 0.2; d += 0.4 * DT) {
      r.run(DT * 1000, { ...blind, dist: d });
    }
    r.run(cfg.fistFallbackMs - 500, { ...blind, dist: 0.7 });
    expect(r.m.phase).toBe('ready');
    r.run(100, { bowUp: false });
    r.run(cfg.fistFallbackMs - 500, { bowUp: true });
    expect(r.m.phase).toBe('ready');
  });

  it('never triggers once a fist has been seen', () => {
    const r = new Rig();
    r.run(100, { known: true, closed: false });
    r.run(cfg.fistFallbackMs + 1000, blind);
    expect(r.m.phase).toBe('ready');
  });

  function autoNocked(): Rig {
    const r = new Rig();
    r.run(cfg.fistFallbackMs + 200, blind);
    expect(r.m.phase).toBe('drawing');
    return r;
  }

  it('releases on a quick move toward the bow hand from full draw', () => {
    const r = autoNocked();
    r.run(900, { ...blind, dist: 2.2, yaw: 0.04 });
    expect(r.m.phase).toBe('drawing');
    // Distance shrinks at 5 sw/s.
    let ev: StepEventValue = StepEvent.None;
    let dist = 2.2;
    for (let i = 0; i < 40 && ev === StepEvent.None; i++) {
      dist -= 5 * DT;
      ev = r.run(DT * 1000, { ...blind, dist });
    }
    expect(ev).toBe(StepEvent.Shot);
    expect(r.m.shot.draw).toBeGreaterThan(0.9);
    expect(r.m.shot.yaw).toBeCloseTo(0.04);
  });

  it('does not release on a slow drift in', () => {
    const r = autoNocked();
    r.run(900, { ...blind, dist: 2.2 });
    let dist = 2.2;
    for (let i = 0; i < 60; i++) {
      dist -= 1 * DT;
      r.run(DT * 1000, { ...blind, dist });
    }
    expect(r.m.phase).toBe('drawing');
  });

  it('releases after the draw has been held steady', () => {
    const r = autoNocked();
    r.run(cfg.fallbackHoldMs - 500, { ...blind, dist: 2.2 });
    expect(r.m.phase).toBe('drawing');
    expect(r.run(1500, { ...blind, dist: 2.2 })).toBe(StepEvent.Shot);
  });

  it('a wandering draw restarts the hold', () => {
    const r = autoNocked();
    r.run(cfg.fallbackHoldMs - 600, { ...blind, dist: 2.2 });
    r.run(100, { ...blind, dist: 1.5 });
    r.run(cfg.fallbackHoldMs - 600, { ...blind, dist: 1.5 });
    expect(r.m.phase).toBe('drawing');
  });
});
