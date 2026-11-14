import { describe, expect, it } from 'vitest';
import { runScript, syntheticCalibration } from '../../input/testing/runScript';
import type { GameEvent, InputState, Side } from '../../input/types';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { drawBow, idle } from '../../tracking/synthetic/scripts/moves';
import { bowArmUp, otherSide, targetPitch, targetYaw, wristDistanceRawException } from './aim';
import { adjustSteps, nockSteps, pullSteps, releaseSteps } from './bot';
import { archeryConfig } from './config';
import { DrawMachine, StepEvent } from './draw';
import type { StepEventValue } from './draw';

const cfg = { ...archeryConfig };

interface Frame {
  t: number;
  valid: boolean;
  bowUp: boolean;
  dist: number;
  present: boolean;
  known: boolean;
  closed: boolean;
  yaw: number;
  pitch: number;
}

interface Outcome {
  events: StepEventValue[];
  maxDraw: number;
  everBowUp: boolean;
  minDistAtNock: number;
  shot: { draw: number; yaw: number; pitch: number } | null;
  fistOpened: boolean;
}

/** Play steps through the real tracking stack and feed the sport's own rules from the state. */
function play(steps: ScriptStep[], drawHand: Side): Outcome {
  const bowHand = otherSide(drawHand);
  const frames: Frame[] = [];
  const cal = { ...syntheticCalibration(), handedness: drawHand };
  const run = runScript(
    { name: 'archery-test', steps },
    {
      calibration: cal,
      extraMs: 600,
      onFrame: (s: InputState, t: number) => {
        const dist = wristDistanceRawException(s.pose, s.aspect, s.shoulderWidth);
        const valid = s.hasPose && s.tracking && dist >= 0;
        const arm = s.arms[bowHand];
        const hand = s.hands[drawHand];
        frames.push({
          t,
          valid,
          bowUp: valid && bowArmUp(arm.wristX, arm.wristY, cfg),
          dist,
          present: hand.present,
          known: hand.known,
          closed: hand.closed,
          yaw: targetYaw(arm.wristX, bowHand, cfg),
          pitch: targetPitch(arm.wristY, cfg),
        });
      },
    },
  );
  const machine = new DrawMachine(cfg);
  const mine: GameEvent[] = run.events.filter(
    (e) => (e.type === 'FistClosed' || e.type === 'FistOpened') && e.hand === drawHand,
  );
  const out: Outcome = {
    events: [],
    maxDraw: 0,
    everBowUp: false,
    minDistAtNock: 99,
    shot: null,
    fistOpened: mine.some((e) => e.type === 'FistOpened'),
  };
  let next = 0;
  let prev = 0;
  for (const f of frames) {
    while (next < mine.length && mine[next]!.t <= f.t) {
      const e = mine[next++]!;
      if (e.type === 'FistClosed') machine.noteClosed();
      else machine.noteOpened(e.t);
    }
    const dt = Math.max(0.001, (f.t - prev) / 1000);
    prev = f.t;
    const ev = machine.step(dt, f.t, f);
    if (f.bowUp) out.everBowUp = true;
    if (machine.phase === 'drawing') out.maxDraw = Math.max(out.maxDraw, machine.draw);
    if (ev !== StepEvent.None) out.events.push(ev);
    if (ev === StepEvent.Nock) out.minDistAtNock = Math.min(out.minDistAtNock, f.dist);
    if (ev === StepEvent.Shot) out.shot = { ...machine.shot };
  }
  return out;
}

for (const drawHand of ['right', 'left'] as const) {
  describe(`bot steps through the real tracker, ${drawHand}-handed`, () => {
    const full: ScriptStep[] = [
      ...nockSteps(drawHand),
      ...pullSteps(drawHand, 0, 1),
      ...idle(600),
      ...releaseSteps(drawHand),
    ];

    it('raises the bow arm, nocks, draws past 0.8 and releases', () => {
      const o = play(full, drawHand);
      expect(o.everBowUp).toBe(true);
      expect(o.fistOpened).toBe(true);
      expect(o.events).toEqual([StepEvent.Nock, StepEvent.Shot]);
      expect(o.minDistAtNock).toBeLessThan(cfg.nockDistance);
      expect(o.maxDraw).toBeGreaterThan(0.8);
      expect(o.shot?.draw ?? 0).toBeGreaterThan(0.8);
    });

    it('aims toward the bow side with the bow wrist and adjusts closed-loop', () => {
      const sb = drawHand === 'right' ? -1 : 1;
      // Out at 1.2 sw is neutral; 1.6 sw aims further out, 0.8 sw back across.
      const o = play(
        [
          ...nockSteps(drawHand),
          ...pullSteps(drawHand, 0, 1),
          ...adjustSteps(drawHand, 1.6, 0.2, 800),
          ...releaseSteps(drawHand),
        ],
        drawHand,
      );
      expect(o.events).toEqual([StepEvent.Nock, StepEvent.Shot]);
      expect(Math.sign(o.shot!.yaw)).toBe(sb);
      expect(Math.abs(o.shot!.yaw)).toBeGreaterThan(0.06);
      expect(o.shot!.pitch).toBeGreaterThan(0.02);
    });

    it('a partial pull gives a partial draw', () => {
      const o = play(
        [
          ...nockSteps(drawHand),
          ...pullSteps(drawHand, 0, 0.45),
          ...idle(500),
          ...releaseSteps(drawHand),
        ],
        drawHand,
      );
      expect(o.events).toEqual([StepEvent.Nock, StepEvent.Shot]);
      expect(o.shot!.draw).toBeGreaterThan(0.3);
      expect(o.shot!.draw).toBeLessThan(0.8);
    });

    it('does not nock with the bow arm hanging', () => {
      const o = play(
        [{ dur: 400, to: drawHand === 'right' ? { rightFist: 1 } : { leftFist: 1 } }, ...idle(600)],
        drawHand,
      );
      expect(o.events).toEqual([]);
    });
  });
}

describe('moves.drawBow', () => {
  it('does not satisfy the nock rule, so the bot builds its own steps', () => {
    // drawBow starts the hands 0.9 sw apart (the nock distance) with a 1.3 sw bow arm: the nock
    // never registers, so the archery bot uses nockSteps / pullSteps instead.
    const o = play(drawBow('right', { draw: 1, holdMs: 600 }), 'right');
    expect(o.everBowUp).toBe(true);
    expect(o.fistOpened).toBe(true);
    expect(o.events).toEqual([]);
  });
});
