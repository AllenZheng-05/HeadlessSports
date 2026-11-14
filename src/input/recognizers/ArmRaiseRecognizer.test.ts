import { describe, expect, it } from 'vitest';
import { collector, drive, ofType } from '../testing/collect';
import { createTestState, setWrist } from '../testing/frames';
import { ArmRaiseRecognizer } from './ArmRaiseRecognizer';
import { recognizerConfig } from './config';

/** `rightY(t)` drives the right wrist; the left one hangs unless `leftY` is given. */
function run(rightY: (t: number) => number, toMs = 2000, leftY: (t: number) => number = () => -1) {
  const wristYOf = (t: number, side: 'left' | 'right'): number =>
    side === 'right' ? rightY(t) : leftY(t);
  const rec = new ArmRaiseRecognizer();
  const state = createTestState();
  const { events, emit } = collector();
  drive(rec, state, emit, 0, toMs, (t) => {
    setWrist(state, 'left', -0.3, wristYOf(t, 'left'));
    setWrist(state, 'right', 0.3, wristYOf(t, 'right'));
  });
  return events;
}

describe('ArmRaiseRecognizer', () => {
  const c = recognizerConfig.armRaise;

  it('fires once after the dwell, stamped when the dwell completes', () => {
    const events = run((t) => (t >= 300 ? 1.0 : -1));
    const raised = ofType(events, 'ArmRaised');
    expect(raised).toHaveLength(1);
    expect(raised[0].hand).toBe('right');
    expect(raised[0].both).toBe(false);
    // First frame above is at 300+ (30 Hz grid); the event comes dwellMs later, within a frame.
    expect(raised[0].t).toBeGreaterThanOrEqual(300 + c.dwellMs);
    expect(raised[0].t).toBeLessThan(300 + c.dwellMs + 40);
    expect(ofType(events, 'ArmLowered')).toHaveLength(0);
  });

  it('ignores a raise shorter than the dwell', () => {
    const events = run((t) => (t >= 300 && t < 300 + c.dwellMs - 60 ? 1.0 : -1));
    expect(events).toHaveLength(0);
  });

  it('needs a continuous dwell: dipping below the raise line restarts it', () => {
    const events = run((t) =>
      t >= 300 && t < 400 ? 1.0 : t >= 400 && t < 450 ? 0.5 : t >= 450 && t < 560 ? 1.0 : -1,
    );
    expect(events).toHaveLength(0);
  });

  it('hysteresis: between lowerBelow and raiseAbove stays raised, below lowerBelow lowers', () => {
    const mid = (c.raiseAbove + c.lowerBelow) / 2;
    const events = run(
      (t) => (t < 300 ? -1 : t < 800 ? 1.0 : t < 1200 ? mid : t < 1400 ? 1.0 : -1),
      2000,
    );
    expect(ofType(events, 'ArmRaised')).toHaveLength(1);
    const lowered = ofType(events, 'ArmLowered');
    expect(lowered).toHaveLength(1);
    expect(lowered[0].t).toBeGreaterThanOrEqual(1400);
  });

  it('can raise again after lowering', () => {
    const events = run((t) => ((t >= 200 && t < 700) || (t >= 1200 && t < 1700) ? 1.0 : -1), 2400);
    expect(ofType(events, 'ArmRaised')).toHaveLength(2);
    expect(ofType(events, 'ArmLowered')).toHaveLength(2);
  });

  it('reports both when the other arm is already raised', () => {
    const events = run(
      (t) => (t >= 800 ? 1.0 : -1),
      2000,
      (t) => (t >= 200 ? 1.0 : -1),
    );
    const raised = ofType(events, 'ArmRaised');
    expect(raised.map((e) => [e.hand, e.both])).toEqual([
      ['left', false],
      ['right', true],
    ]);
  });

  it('reset forgets a raised arm', () => {
    const rec = new ArmRaiseRecognizer();
    const state = createTestState();
    const { events, emit } = collector();
    drive(rec, state, emit, 0, 600, () => setWrist(state, 'right', 0.3, 1));
    expect(ofType(events, 'ArmRaised')).toHaveLength(1);
    rec.reset();
    drive(rec, state, emit, 600, 1400, () => setWrist(state, 'right', 0.3, 1));
    expect(ofType(events, 'ArmRaised')).toHaveLength(2);
  });
});
