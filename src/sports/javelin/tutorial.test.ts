import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Coach } from '../../core/sport';
import { recognizerConfig } from '../../input/recognizers/config';
import { syntheticCalibration } from '../../input/testing/runScript';
import { TrackedInput } from '../../input/TrackedInput';
import type { FrameProblem, GameEvent } from '../../input/types';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { createJavelinBot } from './bot';
import type { TutorialProbe } from './bot';
import { javelinConfig } from './config';
import {
  createGame,
  createMouseRun,
  onStep,
  onThrow,
  restartAttempt,
  stepGame,
  stepMouseRun,
} from './game';
import type { GameState } from './game';
import { applyJavelinRecognizer } from './recognizer';
import { createJavelinTutorial, holdBack } from './tutorial';
import type { JavelinTutorial } from './tutorial';

const cfg = { ...javelinConfig };
const DT = 1 / 120;

function fakeCoach() {
  let skip: (() => void) | null = null;
  const shown: string[] = [];
  const details: (string | null)[] = [];
  const coach = {
    show: vi.fn((_i: number, _n: number, text: string, detail?: string | null) => {
      shown.push(text);
      details.push(detail ?? null);
    }),
    setFeedback: vi.fn(),
    confirm: vi.fn(),
    onSkip: vi.fn((h: () => void) => {
      skip = h;
      return () => undefined;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, shown, details, pressSkip: () => skip?.() };
}

let restore = (): void => undefined;
beforeEach(() => {
  restore = applyJavelinRecognizer(cfg, recognizerConfig);
});
afterEach(() => {
  restore();
});

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The real rules, the real recognizers and the bot, with the tutorial watching (as the sport wires it). */
function simulateCamera(seed: number, hand: 'left' | 'right', seconds: number) {
  const game = createGame(1_000_000);
  const probe: TutorialProbe = { hold: false, standing: false };
  const { coach, shown } = fakeCoach();
  const source = createSyntheticSource({
    script: { name: 'idle', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  input.setCalibration({ ...syntheticCalibration(), handedness: hand });
  const pending: GameEvent[] = [];
  input.onAny((e) => {
    if (e.type === 'Step' || e.type === 'ThrowReleased') pending.push(e);
  });
  void input.start({ pose: true, handCrops: false, fullFrameHands: false });
  const bot = createJavelinBot(cfg, game, hand, mulberry(seed), null, 'legs', probe);
  source.setDirector((_q, _rel, frameT) =>
    bot.next((steps: ScriptStep[]) => source.queue?.enqueue(steps), frameT),
  );
  let finishedAt = -1;
  let now = 0;
  const tutorial = createJavelinTutorial({
    cfg,
    game,
    hand,
    coach,
    mouse: false,
    body: () => input.state,
    notice: () => '',
    probe,
    onFinished: () => {
      finishedAt = now;
    },
  });
  let maxPosition = 0;
  let fouls = 0;
  let throwsTaken = 0;
  const frameMs = 1000 / 60;
  for (let i = 0; i * frameMs < seconds * 1000 && finishedAt < 0; i++) {
    now = i * frameMs;
    input.update(now);
    for (let k = 0; k < 2; k++) {
      const t = now + k * (frameMs / 2);
      for (const e of pending) {
        if (e.type === 'Step') onStep(game, cfg, e.t);
        else if (e.type === 'ThrowReleased') {
          if (
            onThrow(
              game,
              cfg,
              t,
              {
                t: e.t,
                hand: e.hand,
                speed: e.speed,
                vy: e.vy,
                vx: e.vx,
                style: e.style,
                travel: e.travel,
                topY: e.topY,
              },
              hand,
            )
          ) {
            throwsTaken++;
          }
        }
      }
      pending.length = 0;
      const landed = game.landSeq;
      stepGame(game, cfg, DT, t, input.state.cadence.amplitude);
      if (!tutorial.free) holdBack(game, cfg);
      if (game.landSeq !== landed && game.lastFoul) fouls++;
      maxPosition = Math.max(maxPosition, game.position);
    }
    tutorial.update(now);
  }
  input.stop();
  return { finishedAt, shown, tutorial, game, maxPosition, fouls, throwsTaken };
}

describe('javelin tutorial (camera), closed loop with the bot', () => {
  for (const hand of ['right', 'left'] as const) {
    it(`the bot finishes it, ${hand}-handed, on four seeds, with no foul`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const r = simulateCamera(seed, hand, 150);
        expect(r.finishedAt, `seed ${seed}`).toBeGreaterThan(0);
        expect(r.shown.length, `seed ${seed}`).toBe(6);
        expect(r.tutorial.finished).toBe(true);
        // The running steps never reach the line; the bot throws before it in the run-up steps.
        expect(r.fouls, `seed ${seed}`).toBe(0);
        // A standing throw, a run-up throw and one more.
        expect(r.throwsTaken, `seed ${seed}`).toBeGreaterThanOrEqual(3);
        // The tutorial has no attempt limit: the round is never over.
        expect(r.game.phase).not.toBe('done');
      }
    }, 120_000);
  }

  it('shows the steps in the planned order, one short line each', () => {
    const r = simulateCamera(1, 'right', 150);
    expect(r.shown).toEqual([
      'Stand so I can see your whole body',
      'Jog on the spot',
      'Jog faster: speed adds distance',
      'Raise your right hand over your shoulder and throw',
      'Run up and throw before the line',
      'One more for distance',
    ]);
    for (const line of r.shown) expect(line.length).toBeLessThan(60);
  }, 60_000);
});

interface Rig {
  tutorial: JavelinTutorial;
  game: GameState;
  probe: TutorialProbe;
  body: { tracking: boolean; problem: FrameProblem };
  notice: { text: string };
  finished: ReturnType<typeof vi.fn>;
  coach: ReturnType<typeof fakeCoach>;
  run(ms: number): void;
}

function rig(mouse = false): Rig {
  const game = createGame(1_000_000);
  const probe: TutorialProbe = { hold: false, standing: false };
  const body = { tracking: true, problem: 'none' as FrameProblem };
  const notice = { text: '' };
  const finished = vi.fn();
  const coach = fakeCoach();
  const tutorial = createJavelinTutorial({
    cfg,
    game,
    hand: 'right',
    coach: coach.coach,
    mouse,
    body: () => body,
    notice: () => notice.text,
    probe,
    onFinished: finished,
  });
  let now = 0;
  const t: Rig = {
    tutorial,
    game,
    probe,
    body,
    notice,
    finished,
    coach,
    run(ms: number): void {
      for (const end = now + ms; now < end;) {
        now += 50;
        tutorial.update(now);
      }
    },
  };
  return t;
}

/** Skip to step `n` (0-based). */
function skipTo(t: Rig, n: number): void {
  for (let i = 0; i < n; i++) {
    t.coach.pressSkip();
    t.run(100);
  }
}

/** Pretend a legal throw has landed (after a run of `runSpeed` m/s). */
function land(g: GameState, foul: boolean, runSpeed: number): void {
  g.release.runSpeed = runSpeed;
  g.lastFoul = foul;
  g.landSeq++;
}

describe('javelin tutorial steps', () => {
  it('step 1 needs a tracked body for a moment and names what is wrong after a pause', () => {
    const t = rig();
    const fb = t.coach.coach.setFeedback;
    t.body.tracking = false;
    t.body.problem = 'lost';
    t.run(200);
    expect(fb).toHaveBeenLastCalledWith(null);
    t.run(3200);
    expect(fb).toHaveBeenLastCalledWith("I can't see you");
    t.body.problem = 'step-back';
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Step back a little');
    expect(t.tutorial.step).toBe(0);
    t.body.tracking = true;
    t.body.problem = 'none';
    t.run(3000);
    expect(t.tutorial.step).toBeGreaterThanOrEqual(1);
    expect(t.coach.coach.confirm).toHaveBeenCalled();
  });

  it('the running steps hold the throw back; the bot is told to keep jogging', () => {
    const t = rig();
    t.run(100);
    expect(t.game.noThrow).toBe(true);
    expect(t.probe.hold).toBe(true);
    expect(t.tutorial.free).toBe(false);
    expect(t.tutorial.showLine).toBe(false);
    skipTo(t, 1);
    expect(t.tutorial.showSpeed).toBe(true);
  });

  it('step 2 needs a steady jog; it is not satisfied by a single burst', () => {
    const t = rig();
    skipTo(t, 1);
    expect(t.tutorial.step).toBe(1);
    const fb = t.coach.coach.setFeedback;
    t.game.cadenceNow = cfg.tutorialJogCadence + 0.5;
    t.run(1000);
    t.game.cadenceNow = 0;
    t.run(2300);
    expect(t.tutorial.step).toBe(1);
    expect(fb).toHaveBeenLastCalledWith('Lift your knees or pump your arms a little more');
    t.game.cadenceNow = cfg.tutorialJogCadence + 0.5;
    t.run(cfg.tutorialJogMs + 1500);
    expect(t.tutorial.step).toBe(2);
  });

  it('step 3 needs the fast pace', () => {
    const t = rig();
    skipTo(t, 2);
    t.game.cadenceNow = cfg.tutorialJogCadence + 0.5;
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
    t.game.cadenceNow = cfg.tutorialFastCadence + 0.2;
    t.run(cfg.tutorialFastMs + 1500);
    expect(t.tutorial.step).toBe(3);
  });

  it('step 4 starts a standing throw: throws allowed, no run-up needed, measured from the hand', () => {
    const t = rig();
    skipTo(t, 3);
    expect(t.tutorial.step).toBe(3);
    expect(t.game.noThrow).toBe(false);
    expect(t.game.standing).toBe(true);
    expect(t.probe.standing).toBe(true);
    expect(t.probe.hold).toBe(false);
    expect(t.game.phase).toBe('run');
    expect(t.game.position).toBe(0);
    expect(t.coach.shown[3]).toContain('right hand');
    // A refused throw is explained in the panel, straight away.
    t.notice.text = 'Throw faster';
    t.run(100);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Throw faster');
    t.notice.text = '';
    // It lands, and counts, even with no run.
    land(t.game, false, 0);
    t.run(3000);
    expect(t.tutorial.step).toBe(4);
  });

  it('a standing throw is accepted by the rules and measured from where it was thrown', () => {
    const g = createGame(1_000_000);
    g.noThrow = false;
    g.standing = true;
    restartAttempt(g, cfg, 1000);
    expect(g.phase).toBe('run');
    const ev = { t: 1500, hand: 'right' as const, speed: 9, vy: 3, style: 'overarm' as const };
    expect(onThrow(g, cfg, 1500, ev, 'right')).toBe(true);
    expect(g.flightFoul).toBe(false);
    for (let i = 0; i < 120 * 20 && g.phase !== 'result'; i++) {
      stepGame(g, cfg, DT, 1500 + i * 8, 0);
    }
    expect(g.phase).toBe('result');
    expect(g.lastFoul).toBe(false);
    expect(g.lastDistance).toBeGreaterThan(5);
    expect(g.lastDistance).toBeCloseTo(g.flight.x - g.release.x, 6);
  });

  it('while only running, a throw is not taken', () => {
    const g = createGame(3);
    restartAttempt(g, cfg, 0);
    g.noThrow = true;
    const ev = { t: 1000, hand: 'right' as const, speed: 12, vy: 3, style: 'overarm' as const };
    expect(onThrow(g, cfg, 1000, ev, 'right')).toBe(false);
    expect(g.phase).toBe('run');
    g.noThrow = false;
    expect(onThrow(g, cfg, 1000, ev, 'right')).toBe(true);
  });

  it('step 5 wants a run-up: a standing throw explains itself, a foul resets with a reason', () => {
    const t = rig();
    skipTo(t, 4);
    expect(t.tutorial.step).toBe(4);
    expect(t.tutorial.free).toBe(true);
    expect(t.game.standing).toBe(false);
    expect(t.tutorial.showLine).toBe(true);
    const fb = t.coach.coach.setFeedback;
    // Thrown without running: does not count.
    land(t.game, false, 0.2);
    t.run(3000);
    expect(t.tutorial.step).toBe(4);
    expect(fb).toHaveBeenCalledWith('Run first, then throw');
    // Crossed the line: the reason, no penalty, and it still has to be thrown.
    land(t.game, true, 8);
    t.run(200);
    expect(fb).toHaveBeenLastCalledWith('You crossed the line. Throw a little sooner');
    expect(t.tutorial.step).toBe(4);
    // The reason goes away after a while.
    t.run(cfg.tutorialFoulMs + 500);
    expect(fb).toHaveBeenLastCalledWith('Jog on the spot to build speed');
    // A legal throw after a run.
    land(t.game, false, 6);
    t.run(3000);
    expect(t.tutorial.step).toBe(5);
  });

  it('step 5 says "Throw now" near the line, and step 6 takes any legal throw', () => {
    const t = rig();
    skipTo(t, 4);
    t.game.phase = 'run';
    t.game.position = cfg.runwayLength - cfg.throwZone + 1;
    t.run(100);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Throw now');
    skipTo(t, 1);
    expect(t.tutorial.step).toBe(5);
    land(t.game, false, 0);
    t.run(3000);
    expect(t.finished).toHaveBeenCalledTimes(1);
    expect(t.tutorial.finished).toBe(true);
  });

  it('the foul line explanation is a detail line of the run-up step', () => {
    const t = rig();
    skipTo(t, 4);
    expect(t.coach.details[4]).toMatch(/foul line/);
  });

  it('a skipped step moves on, and skipping the last one finishes once', () => {
    const t = rig();
    t.tutorial.update(0);
    for (let i = 0; i < 6; i++) {
      t.coach.pressSkip();
      t.tutorial.update(100 + i * 16);
      t.tutorial.update(110 + i * 16);
    }
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.coach.pressSkip();
    t.tutorial.update(5000);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.tutorial.dispose();
    expect(t.coach.coach.hide).toHaveBeenCalled();
    expect(t.game.noThrow).toBe(false);
  });
});

describe('holdBack', () => {
  it('stops the athlete short of the line while running, and leaves other phases alone', () => {
    const g = createGame(3);
    g.phase = 'run';
    g.position = cfg.runwayLength + 3;
    holdBack(g, cfg);
    expect(g.position).toBe(cfg.runwayLength - cfg.tutorialHoldBackM);
    g.phase = 'flight';
    g.position = cfg.runwayLength + 3;
    holdBack(g, cfg);
    expect(g.position).toBe(cfg.runwayLength + 3);
  });
});

/** Mouse play without a browser: hold until near the line, let go, again. */
function simulateMouse(seconds: number) {
  const game = createGame(1_000_000);
  const probe: TutorialProbe = { hold: false, standing: false };
  const { coach, shown } = fakeCoach();
  let finishedAt = -1;
  let now = 0;
  const tutorial = createJavelinTutorial({
    cfg,
    game,
    hand: 'right',
    coach,
    mouse: true,
    body: () => ({ tracking: true, problem: 'none' }),
    notice: () => '',
    probe,
    onFinished: () => {
      finishedAt = now;
    },
  });
  const run = createMouseRun(0);
  let down = false;
  let releases = 0;
  let fouls = 0;
  const frameMs = 1000 / 60;
  for (let i = 0; i * frameMs < seconds * 1000 && finishedAt < 0; i++) {
    now = i * frameMs;
    for (let k = 0; k < 2; k++) {
      const t = now + k * (frameMs / 2);
      // The player holds while running and lets go when the line is 3 m away; in step 1 never lets go.
      const near = game.phase === 'run' && cfg.runwayLength - game.position < 3;
      if (game.phase === 'run' && !down && !near) down = true;
      if (down && near && tutorial.free) {
        down = false;
        releases++;
      }
      const landed = game.landSeq;
      const target = stepMouseRun(run, game, cfg, t, DT, down, releases, false, 'right');
      stepGame(game, cfg, DT, t, 0, target);
      if (!tutorial.free) holdBack(game, cfg);
      if (game.landSeq !== landed && game.lastFoul) fouls++;
    }
    tutorial.update(now);
  }
  return { finishedAt, shown, fouls, tutorial };
}

describe('javelin tutorial (mouse)', () => {
  it('has the three mouse steps and a simulated mouse player finishes them', () => {
    const r = simulateMouse(120);
    expect(r.finishedAt).toBeGreaterThan(0);
    expect(r.shown).toEqual([
      'Press and hold the button to run',
      'Let go before the line to throw',
      'One more for distance',
    ]);
    expect(r.fouls).toBe(0);
  });

  it('names the mouse actions when nothing happens', () => {
    const t = rig(true);
    expect(t.tutorial.stepCount).toBe(3);
    t.run(3300);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Press and hold the mouse button');
    skipTo(t, 1);
    t.game.phase = 'run';
    t.game.position = cfg.runwayLength - 4;
    t.run(100);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Let go now');
    land(t.game, false, 0.5);
    t.run(200);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith(
      'Hold the button a little longer to run',
    );
  });
});
