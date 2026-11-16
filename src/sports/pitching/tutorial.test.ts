import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import type { Coach } from '../../core/sport';
import { syntheticCalibration } from '../../input/testing/runScript';
import { TrackedInput } from '../../input/TrackedInput';
import type { Side } from '../../input/types';
import { POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { createLiveInput, gloveSide, trackedLive } from './aim';
import type { PitchKind } from './aim';
import { createPitchingBot } from './bot';
import type { TutorialProbe } from './bot';
import { pitchingConfig } from './config';
import { createGame, onThrow, pickKind, ringShown, stepGame } from './game';
import type { GameState, HandInput } from './game';
import { LiveAim } from './liveAim';
import { createPitchTutorial } from './tutorial';
import type { PitchTutorial, RingView, SeenView } from './tutorial';
import { cellCentre } from './zone';
import type { Point } from './zone';

function fakeCoach() {
  let skip: (() => void) | null = null;
  const shown: string[] = [];
  const confirmed: (string | undefined)[] = [];
  const coach = {
    show: vi.fn((_i: number, _n: number, text: string, _detail?: string | null) => {
      shown.push(text);
    }),
    setFeedback: vi.fn(),
    confirm: vi.fn((text?: string) => {
      confirmed.push(text);
    }),
    onSkip: vi.fn((h: () => void) => {
      skip = h;
      return () => undefined;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, shown, confirmed, pressSkip: () => skip?.() };
}

/**
 * The whole closed loop without a browser: the bot plays through the synthetic source and the real
 * recognizers, the real rules run at 120 Hz with the sport's own live aim, and the tutorial watches.
 */
function simulate(seed: number, hand: Side, seconds: number) {
  const cfg = { ...pitchingConfig };
  const glove = gloveSide(hand);
  const game = createGame(
    1_000_000,
    mulberry32(seed),
    false,
    cfg.tutorialGapScale,
    0,
    cfg.curveShare,
    false,
    true,
  );
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  input.setCalibration({ ...syntheticCalibration(), handedness: hand });
  const probe: TutorialProbe = { stage: 'normal' };
  const bot = createPitchingBot(cfg, game, hand, mulberry32(seed + 1000), probe);
  source.setDirector((_q, rel) => bot.next((steps) => source.queue?.enqueue(steps), rel));
  const { coach, shown, confirmed } = fakeCoach();
  const ring: RingView = { visible: false, x: 0, y: 0 };
  const seen: SeenView = { tracked: false, glove: false, thrower: false };
  let finishedAt = -1;
  let now = 0;
  const tutorial = createPitchTutorial({
    cfg,
    game,
    coach,
    hand,
    mouse: false,
    ring,
    seen,
    probe,
    onFinished: () => {
      finishedAt = now;
    },
  });
  const liveAim = new LiveAim();
  const liveIn = createLiveInput();
  const liveRelease = { rawX: 0, rawY: 0, x: 0, y: 0, kmh: 0, scoredKmh: 0 };
  const scratch: Point = { x: 0, y: 0 };
  const pending: {
    t: number;
    speed: number;
    vy: number;
    lateral: number;
    curvature: number;
    style: 'overarm' | 'underarm';
    hand: Side;
  }[] = [];
  input.on('ThrowReleased', (e) => pending.push(e));
  const hin: HandInput = { present: false, known: false, closed: false, speed: 0 };
  let seenCall = game.callSeq;
  const wrist = (side: Side): boolean =>
    input.state.pose[
      (side === 'left' ? PoseIndex.LEFT_WRIST : PoseIndex.RIGHT_WRIST) * POSE_STRIDE + 3
    ]! >= cfg.gloveMinVisibility;
  let balks = 0;
  void input.start({ pose: true, handCrops: true, fullFrameHands: false });
  for (let i = 0; i < seconds * 60 && finishedAt < 0; i++) {
    now = (i * 1000) / 60;
    input.update(now);
    const st = input.state;
    for (let sub = 0; sub < 2; sub++) {
      if (game.callSeq !== seenCall) {
        seenCall = game.callSeq;
        liveAim.reset();
      }
      if (st.tracking && st.hasPose) {
        trackedLive(cfg, st.arms[glove], st.arms[hand].speed, hand, wrist(glove), liveIn, scratch);
        let kind: PitchKind = game.kind;
        if (game.phase === 'call' || game.phase === 'sign') {
          kind = game.reading === 'none' ? game.called : game.reading;
        }
        liveAim.update(cfg, st.t, liveIn, hand, kind, game.target, scratch);
      }
      for (const e of pending) {
        const haveLive = liveAim.ready && liveAim.forRelease(cfg, e.t, true, liveRelease);
        onThrow(game, cfg, now, e, hand, false, haveLive ? liveRelease : null);
      }
      pending.length = 0;
      const h = st.hands[hand];
      hin.present = h.present;
      hin.known = h.known;
      hin.closed = h.closed;
      hin.speed = st.arms[hand].speed;
      stepGame(game, cfg, 1 / 120, hin, false);
    }
    ring.visible = ringShown(game, liveAim.ready);
    ring.x = liveAim.aim.x;
    ring.y = liveAim.aim.y;
    seen.tracked = st.tracking && st.hasPose;
    seen.glove = wrist(glove);
    seen.thrower = wrist(hand);
    tutorial.update(now);
    balks = game.records.filter((r) => r.balk).length;
  }
  input.stop();
  return { finishedAt, shown, confirmed, game, steps: tutorial.stepCount, balks, cfg };
}

describe('pitching tutorial (camera)', () => {
  for (const hand of ['right', 'left'] as const) {
    it(`the bot completes every step, ${hand}-handed, on several seeds`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const r = simulate(seed, hand, 150);
        expect(r.finishedAt, `seed ${seed}`).toBeGreaterThan(0);
        expect(r.shown.length, `seed ${seed}`).toBe(7);
        expect(r.balks).toBe(0);
        // A curveball was thrown, and the last pitch was the pitch called.
        expect(r.game.records.some((p) => p.kind === 'curve')).toBe(true);
        expect(r.game.records.some((p) => p.score.matched && p.called === p.kind)).toBe(true);
        expect(r.game.phase).not.toBe('done');
      }
      // Four closed-loop runs, about 2 s alone; the suite runs many files at once.
    }, 60_000);
  }

  it('shows the steps in the planned order, one short line each', () => {
    const r = simulate(1, 'right', 150);
    expect(r.shown).toEqual([
      'Stand so I can see your shoulders and both hands',
      'Move your glove hand to steer the ring',
      'Hold the ring on the glowing square',
      'Now throw with your other arm',
      'Hold your throwing hand still in a fist for a fastball',
      'Hold it open for a curveball, then throw',
      'The catcher asks for a pitch and a spot. Match both',
    ]);
    for (const line of r.shown) expect(line.length).toBeLessThan(60);
    // The last confirmation says what was matched.
    expect(r.confirmed[6]).toMatch(/^Right pitch/);
  }, 30_000);
});

/** A tutorial over a bare game, for the feedback tests: nothing plays, the test sets the views. */
function rig(mouse = false, hand: Side = 'right') {
  const cfg = { ...pitchingConfig };
  const game = createGame(
    1_000_000,
    mulberry32(7),
    false,
    cfg.tutorialGapScale,
    0,
    cfg.curveShare,
    mouse,
    true,
  );
  const ring: RingView = { visible: false, x: 0, y: 0 };
  const seen: SeenView = { tracked: true, glove: true, thrower: true };
  const probe: TutorialProbe = { stage: 'normal' };
  const finished = vi.fn();
  const c = fakeCoach();
  const tutorial: PitchTutorial = createPitchTutorial({
    cfg,
    game,
    coach: c.coach,
    hand,
    mouse,
    ring,
    seen,
    probe,
    onFinished: finished,
  });
  let now = 0;
  const run = (ms: number): void => {
    for (const end = now + ms; now < end;) {
      now += 50;
      tutorial.update(now);
    }
  };
  const skip = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      c.pressSkip();
      now += 50;
      tutorial.update(now);
      now += 50;
      tutorial.update(now);
    }
  };
  return { cfg, game, ring, seen, probe, finished, c, tutorial, run, skip };
}

const lastFeedback = (t: ReturnType<typeof rig>): unknown =>
  t.c.coach.setFeedback.mock.calls.at(-1)?.[0];

/** Put the game into a windup with `kind` picked, as the sign would. */
function toWindup(g: GameState, cfg: typeof pitchingConfig): void {
  const still: HandInput = { present: true, known: true, closed: true, speed: 0 };
  for (let i = 0; i < 1000 && g.phase !== 'windup'; i++) stepGame(g, cfg, 0.01, still, false);
}

describe('pitching tutorial steps (camera)', () => {
  it('step 1 says what it cannot see, only after a pause', () => {
    const t = rig();
    t.seen.tracked = false;
    t.run(1000);
    expect(lastFeedback(t)).toBe(null);
    t.run(2500);
    expect(lastFeedback(t)).toBe("I can't see your shoulders");
    t.seen.tracked = true;
    t.seen.glove = false;
    t.seen.thrower = false;
    t.run(100);
    expect(lastFeedback(t)).toBe("I can't see your hands");
    t.seen.thrower = true;
    t.run(100);
    // Right-handed: the glove hand is the left one.
    expect(lastFeedback(t)).toBe("I can't see your left hand");
    t.seen.glove = true;
    t.run(2500);
    expect(t.tutorial.step).toBe(1);
  });

  it('the glove step names the glove hand for the dominant hand', () => {
    const r = rig(false, 'right');
    const l = rig(false, 'left');
    for (const t of [r, l]) t.skip();
    expect(r.c.coach.show.mock.calls.at(-1)?.[3]).toBe(
      'Your glove hand is your left one. The ring follows it.',
    );
    expect(l.c.coach.show.mock.calls.at(-1)?.[3]).toBe(
      'Your glove hand is your right one. The ring follows it.',
    );
  });

  it('the steer step needs the ring to travel, and warns about a lost glove', () => {
    const t = rig();
    t.skip();
    t.ring.visible = true;
    t.ring.x = 0;
    t.ring.y = t.cfg.zoneCentreY;
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
    expect(lastFeedback(t)).toBe('Move your glove hand more');
    t.seen.glove = false;
    t.run(100);
    expect(lastFeedback(t)).toBe("I can't see your glove hand, so I'm aiming at the middle");
    t.seen.glove = true;
    t.ring.x = 0.2;
    t.run(2000);
    expect(t.tutorial.step).toBe(2);
    expect(t.probe.stage).toBe('hold');
  });

  it('the hold step needs a steady second on the glowing square', () => {
    const t = rig();
    t.skip(2);
    const p: Point = { x: 0, y: 0 };
    cellCentre(t.cfg, t.game.target, p);
    t.ring.visible = true;
    t.ring.x = p.x + 0.5;
    t.ring.y = p.y;
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
    t.ring.x = p.x;
    t.run(t.cfg.tutorialHoldMs - 200);
    expect(t.tutorial.step).toBe(2);
    t.ring.x = p.x + 0.5; // off again: the time starts over
    t.run(100);
    t.ring.x = p.x;
    t.run(t.cfg.tutorialHoldMs - 200);
    expect(t.tutorial.step).toBe(2);
    t.run(1200);
    expect(t.tutorial.step).toBe(3);
    expect(t.probe.stage).toBe('throw');
  });

  it('a throw made while the praise is showing counts for the throw step', () => {
    const t = rig();
    t.skip(2);
    const p: Point = { x: 0, y: 0 };
    cellCentre(t.cfg, t.game.target, p);
    t.ring.visible = true;
    t.ring.x = p.x;
    t.ring.y = p.y;
    t.run(2000); // hold done, praise on screen
    t.game.releaseSeq++; // the player threw already
    t.run(3000);
    expect(t.tutorial.step).toBeGreaterThanOrEqual(4);
  });

  it('the throw step names slow throws and the wrong arm', () => {
    const t = rig();
    t.skip(3);
    t.run(3000);
    expect(t.tutorial.step).toBe(3);
    expect(lastFeedback(t)).toBe('Swing your throwing arm over your shoulder');
    t.game.ignored.slow++;
    t.run(100);
    expect(lastFeedback(t)).toBe('Throw a little faster');
    t.game.ignored.wrongHand++;
    t.run(100);
    expect(lastFeedback(t)).toBe('Throw with your other arm');
  });

  it('the fastball step restarts a wrong pick and says what it saw', () => {
    const t = rig();
    t.skip(4);
    expect(t.tutorial.step).toBe(4);
    expect(t.game.autoSelect).toBe(false);
    // An open hand held still: a curveball is picked, which is not what was asked.
    const open: HandInput = { present: true, known: true, closed: false, speed: 0 };
    const calls = t.game.callSeq;
    for (let i = 0; i < 1000 && t.game.phase !== 'windup'; i++)
      stepGame(t.game, t.cfg, 0.01, open, false);
    expect(t.game.kind).toBe('curve');
    t.run(100);
    expect(t.game.callSeq).toBeGreaterThan(calls);
    expect(t.game.phase).toBe('call');
    t.run(3000);
    expect(t.tutorial.step).toBe(4);
    expect(lastFeedback(t)).toBe('That was a curveball. Make a fist instead');
    // A fist, still: fastball picked, step done.
    toWindup(t.game, t.cfg);
    t.run(100);
    expect(t.game.kind).toBe('fastball');
    t.run(2500);
    expect(t.tutorial.step).toBe(5);
    expect(t.game.callKind).toBe('curve');
  });

  it('the curveball step calls a curve and finishes on a curve thrown', () => {
    const t = rig();
    t.skip(5);
    expect(t.tutorial.step).toBe(5);
    expect(t.game.called).toBe('curve');
    // Hold an open hand: a curve is picked.
    const open: HandInput = { present: true, known: true, closed: false, speed: 0 };
    for (let i = 0; i < 1000 && t.game.phase !== 'windup'; i++)
      stepGame(t.game, t.cfg, 0.01, open, false);
    expect(t.game.kind).toBe('curve');
    t.run(100);
    expect(t.tutorial.step).toBe(5);
    t.game.releaseSeq++;
    t.run(2500);
    expect(t.tutorial.step).toBe(6);
  });

  it('the called step explains the bonus and does not count a wrong pitch', () => {
    const t = rig();
    t.skip(6);
    expect(t.tutorial.step).toBe(6);
    expect(t.c.coach.show.mock.calls.at(-1)?.[3]).toBe(
      'The called pitch scores a bonus. The wrong pitch halves your points.',
    );
    expect(t.game.callKind).toBe(null);
    const rec = (matched: boolean, cell: number) =>
      ({
        index: t.game.index,
        kind: 'fastball',
        called: matched ? 'fastball' : 'curve',
        target: 4,
        balk: false,
        x: 0,
        y: 0.8,
        kmh: 90,
        missM: 0,
        score: {
          points: 3,
          tier: 'zone',
          cell,
          base: 3,
          speedBonus: 0,
          curveBonus: 0,
          calledBonus: 0,
          matched,
          label: 'x',
        },
      }) as GameState['records'][number];
    t.game.records.push(rec(false, 4));
    t.game.resultSeq++;
    t.run(3000);
    expect(t.tutorial.step).toBe(6);
    expect(lastFeedback(t)).toBe('Not the pitch called. Fist is fastball, open is curve');
    t.game.index++;
    t.game.records.push(rec(true, 4));
    t.game.resultSeq++;
    t.run(100);
    t.run(2500);
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    expect(t.c.confirmed.at(-1)).toBe('Right pitch, right spot');
  });

  it('skipping every step finishes, once', () => {
    const t = rig();
    t.skip(7);
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.c.pressSkip();
    t.run(500);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.tutorial.dispose();
    expect(t.c.coach.hide).toHaveBeenCalled();
  });
});

describe('pitching tutorial steps (mouse)', () => {
  it('has the four mouse steps and names the buttons', () => {
    const t = rig(true);
    expect(t.tutorial.stepCount).toBe(4);
    t.run(100);
    expect(t.c.shown[0]).toBe('Pick Fastball or Curveball with a button');
    t.run(3000);
    expect(lastFeedback(t)).toBe('Click a pitch button at the bottom left');
  });

  it('counts a button, a held aim, a release, then a called pitch', () => {
    const t = rig(true);
    t.run(100);
    // The buttons only work once the call shows.
    expect(pickKind(t.game, 'curve')).toBe(false);
    t.game.bubbleOn = true;
    expect(pickKind(t.game, 'fastball')).toBe(true);
    t.run(2500);
    expect(t.tutorial.step).toBe(1);
    const p: Point = { x: 0, y: 0 };
    cellCentre(t.cfg, t.game.target, p);
    t.run(3000);
    expect(lastFeedback(t)).toBe('Press and hold on the field');
    t.ring.visible = true;
    t.ring.x = p.x + 0.4;
    t.ring.y = p.y;
    t.run(100);
    expect(lastFeedback(t)).toBe('Move the ring onto the glowing square');
    t.ring.x = p.x;
    t.run(t.cfg.tutorialHoldMs + 2000);
    expect(t.tutorial.step).toBe(2);
    expect(lastFeedback(t)).toBe(null);
    t.run(3000);
    expect(lastFeedback(t)).toBe('Let go of the button');
    t.ring.visible = false;
    t.run(100);
    expect(lastFeedback(t)).toBe('Press and hold, then let go');
    t.game.releaseSeq++;
    t.run(2500);
    expect(t.tutorial.step).toBe(3);
    expect(t.c.coach.show.mock.calls.at(-1)?.[2]).toBe(
      'Match the call: pick the pitch, aim, throw',
    );
  });
});

describe('pitching tutorial, a hand that is never read', () => {
  /** Step the game until a pick falls back to the fastball (no hand seen). */
  const unread = (t: ReturnType<typeof rig>): void => {
    const none: HandInput = { present: false, known: false, closed: false, speed: 0 };
    for (let i = 0; i < 2000 && t.game.phase !== 'windup'; i++)
      stepGame(t.game, t.cfg, 0.01, none, false);
    expect(t.game.usedFallback).toBe(true);
  };

  it('the fastball step restarts the call once, then accepts the fallback and says so', () => {
    const t = rig();
    t.skip(4);
    expect(t.tutorial.step).toBe(4);
    unread(t);
    t.run(100);
    expect(t.game.phase).toBe('call');
    t.run(3000);
    expect(t.tutorial.step).toBe(4);
    expect(lastFeedback(t)).toBe("I couldn't read your hand. Hold it up and still");
    // The second unread pick in a row is accepted.
    unread(t);
    t.run(2500);
    expect(t.c.coach.confirm).toHaveBeenLastCalledWith(
      "I couldn't read your hand, so I picked a fastball",
    );
    expect(t.tutorial.step).toBe(5);
  });

  it('a real read between two unread picks starts the count again', () => {
    const t = rig();
    t.skip(4);
    unread(t);
    t.run(100);
    toWindup(t.game, t.cfg);
    t.run(2500);
    expect(t.c.coach.confirm).toHaveBeenLastCalledWith('Fastball picked');
    expect(t.tutorial.step).toBe(5);
  });

  it('the curveball step accepts after two unread picks, and says what an open hand does', () => {
    const t = rig();
    t.skip(5);
    expect(t.tutorial.step).toBe(5);
    unread(t);
    t.run(3000);
    expect(t.tutorial.step).toBe(5);
    expect(lastFeedback(t)).toBe("I couldn't read your hand. Hold it up and still");
    unread(t);
    t.run(2500);
    expect(t.c.coach.confirm).toHaveBeenLastCalledWith(
      "I couldn't read your hand. In a game, an open hand is a curveball",
    );
    expect(t.tutorial.step).toBe(6);
  });
});
