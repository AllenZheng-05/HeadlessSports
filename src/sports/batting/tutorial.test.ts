import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Coach } from '../../core/sport';
import { mulberry32 } from '../../core/random';
import { recognizerConfig } from '../../input/recognizers/config';
import type { InputState } from '../../input/types';
import { POSE_COUNT, POSE_STRIDE, PoseIndex } from '../../tracking/types';
import { TrackedInput } from '../../input/TrackedInput';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { createBattingBot } from './bot';
import type { TutorialProbe } from './bot';
import { battingConfig } from './config';
import { REJECTION_TEXT, SEEN_LATE_TEXT } from './notice';
import { applyBattingRecognizer } from './recognizer';
import { BattingRound } from './round';
import type { PitchResult } from './round';
import {
  createBattingTutorial,
  createFeed,
  createStanceView,
  noteNotice,
  noteResult,
  noteSwingPeak,
  noteSwingStart,
  readStance,
} from './tutorial';
import type { BattingTutorial, PitchMode, StanceView, TutorialFeed } from './tutorial';

function fakeCoach() {
  let skip: (() => void) | null = null;
  const shown: string[] = [];
  const praise: (string | undefined)[] = [];
  const details: (string | null | undefined)[] = [];
  const coach = {
    show: vi.fn((_i: number, _n: number, text: string, detail?: string | null) => {
      shown.push(text);
      details.push(detail);
    }),
    setFeedback: vi.fn(),
    confirm: vi.fn((text?: string) => {
      praise.push(text);
    }),
    onSkip: vi.fn((h: () => void) => {
      skip = h;
      return () => undefined;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, shown, praise, details, pressSkip: () => skip?.() };
}

/** The closed loop: bot -> synthetic source -> recognizers -> tutorial and the real round. */
function simulate(seed: number, hand: 'left' | 'right', seconds = 150) {
  const cfg = { ...battingConfig };
  const restore = applyBattingRecognizer(hand, recognizerConfig);
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  const feed = createFeed();
  const probe: TutorialProbe = { stance: false, practice: false };
  const stance = createStanceView();
  const { coach, shown, praise } = fakeCoach();
  const results: PitchResult[] = [];
  const modes: PitchMode[] = [];
  let pitching: PitchMode = 'off';
  let round = null as BattingRound | null;
  let clock = 0;
  let finishedAt = -1;
  const direction = hand === 'right' ? 1 : -1;
  const flight = (): number =>
    pitching === 'slow'
      ? cfg.tutorialSlowFlightMs
      : pitching === 'full'
        ? cfg.tutorialFullFlightMs
        : 0;
  const tutorial = createBattingTutorial({
    cfg,
    coach,
    feed,
    mouse: false,
    direction,
    stance: () => {
      readStance(input.state, recognizerConfig.swing.wristVisibility, stance);
      return stance;
    },
    pitchesStarted: () => (round === null ? 0 : round.started),
    setPitching: (mode) => {
      pitching = mode;
      modes.push(mode);
      if (round === null) {
        round = new BattingRound({
          cfg,
          short: false,
          startMs: clock,
          random: mulberry32(seed),
          handedness: () => hand,
          endless: true,
          firstPitchDelayMs: cfg.tutorialFirstPitchMs,
          extraGapMs: cfg.tutorialGapMs,
          flightMs: flight,
          hooks: {
            resolved: (r) => {
              results.push(r);
              noteResult(feed, r);
            },
          },
        });
      }
    },
    probe,
    onFinished: () => {
      finishedAt = clock;
    },
  });
  input.on('SwingStarted', (e) => {
    noteSwingStart(feed, e.t);
    round?.onSwingStarted(e, clock);
  });
  input.on('SwingPeak', (e) => {
    noteSwingPeak(feed, e.t, e.speed);
    round?.onSwingPeak(e, clock);
  });
  const bot = createBattingBot({
    cfg,
    random: mulberry32(seed + 1000),
    direction,
    probe,
    view: {
      pitch: () =>
        round !== null && round.phase === 'pitch' && !round.resolved && round.swingT < 0
          ? round.pitch
          : null,
      over: () => false,
      frameT: () => input.state.t,
    },
  });
  source.setDirector((_q, rel) => bot.next((steps) => source.queue?.enqueue(steps), rel));
  void input.start({ pose: true, handCrops: false, fullFrameHands: false });
  for (let i = 0; i < seconds * 60 && finishedAt < 0; i++) {
    clock = (i * 1000) / 60;
    input.update(clock);
    round?.update(clock);
    tutorial.update(clock);
  }
  input.stop();
  restore();
  return { finishedAt, shown, praise, results, modes, round, tutorial, cfg, feed };
}

describe.each([1, 2, 3, 4])('batting tutorial, closed loop, seed %i', (seed) => {
  it.each(['right', 'left'] as const)('a %s-handed bot finishes every step', (hand) => {
    const r = simulate(seed, hand);
    expect(r.finishedAt, 'finished').toBeGreaterThan(0);
    expect(r.tutorial.finished).toBe(true);
    expect(r.shown).toEqual([
      'Stand so I can see your shoulders and hands',
      'Bring both hands together like holding a bat',
      'Swing across your body, fast',
      'Do it again, a little faster',
      'A slow pitch: swing as it reaches the plate',
      'Now hit one at full speed',
    ]);
    expect(r.modes).toEqual(['slow', 'full']);
    // Slow pitches in the timing step, normal ones after, at most three in the last step.
    expect(r.results.length).toBeGreaterThanOrEqual(2);
    expect(r.results.some((x) => x.kind === 'hit')).toBe(true);
    // It never ends: no limit on pitches.
    expect(['idle', 'pitch']).toContain(r.round?.phase);
    expect(r.finishedAt).toBeLessThan(120_000);
    // The second practice swing shows its measured power.
    expect(r.praise[3]).toMatch(/^Power \d+%$/);
  });
});

describe('batting tutorial copy', () => {
  it('keeps every instruction to one short line', () => {
    const r = simulate(1, 'right');
    for (const line of r.shown) expect(line.length).toBeLessThan(50);
  });

  it('names the direction of the swing for each hand in the stance detail', () => {
    for (const [hand, side] of [
      ['right', 'right'],
      ['left', 'left'],
    ] as const) {
      const coach = fakeCoach();
      const t = rig({ direction: hand === 'right' ? 1 : -1, coach });
      t.tutorial.update(0);
      coach.pressSkip();
      t.tutorial.update(100);
      t.tutorial.update(200);
      expect(coach.details[1]).toContain('Face the camera or turn sideways');
      expect(coach.details[1]).toContain(`${side} of the screen`);
    }
  });
});

interface RigOptions {
  mouse?: boolean;
  direction?: -1 | 1;
  coach?: ReturnType<typeof fakeCoach>;
}

/** A tutorial with hand-set inputs, to look at single steps. */
function rig(opts: RigOptions = {}) {
  const cfg = { ...battingConfig };
  const feed: TutorialFeed = createFeed();
  const stance: StanceView = createStanceView();
  const probe: TutorialProbe = { stance: false, practice: false };
  const coach = opts.coach ?? fakeCoach();
  let started = 0;
  const modes: PitchMode[] = [];
  const finished = vi.fn();
  const tutorial: BattingTutorial = createBattingTutorial({
    cfg,
    coach: coach.coach,
    feed,
    mouse: opts.mouse ?? false,
    direction: opts.direction ?? 1,
    stance: () => stance,
    pitchesStarted: () => started,
    setPitching: (m) => modes.push(m),
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
  const skip = (): void => {
    coach.pressSkip();
    run(100);
  };
  return {
    cfg,
    feed,
    stance,
    probe,
    coach,
    tutorial,
    modes,
    finished,
    run,
    skip,
    get now() {
      return now;
    },
    setStarted: (n: number) => {
      started = n;
    },
  };
}

function result(
  index: number,
  kind: PitchResult['kind'],
  reason: 'early' | 'late' | 'under' | 'over' | null,
  timingError = 0,
): PitchResult {
  return {
    pitch: { index } as PitchResult['pitch'],
    kind,
    judgement: kind === 'strike' ? null : ({ reason, timingError } as PitchResult['judgement']),
    label: '',
    distance: 0,
    homer: false,
    contactMs: 0,
    headingDeg: 0,
    trajectory: null,
  };
}

describe('batting tutorial steps', () => {
  it('step 1 waits for a tracked body with a wrist, and says what is missing, after a pause', () => {
    const t = rig();
    const fb = t.coach.coach.setFeedback;
    t.run(100);
    expect(t.tutorial.step).toBe(0);
    t.run(t.cfg.tutorialHintDelayMs);
    expect(fb).toHaveBeenLastCalledWith("I can't see you. Step back until your shoulders show");
    t.stance.tracked = true;
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith("I can't see your hands");
    t.stance.wrists = 1;
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
  });

  it('the stance step needs both hands close, at chest height and still, then asks the bot for it', () => {
    const t = rig();
    t.stance.tracked = true;
    t.stance.wrists = 2;
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
    expect(t.probe.stance).toBe(true);
    const fb = t.coach.coach.setFeedback;
    // Hands apart.
    t.stance.gap = 1.2;
    t.run(t.cfg.tutorialHintDelayMs + 200);
    expect(t.tutorial.step).toBe(1);
    expect(fb).toHaveBeenLastCalledWith('Bring your hands closer together');
    // Together but at the sides.
    t.stance.gap = 0.3;
    t.stance.lowY = -2;
    t.stance.highY = -2;
    t.run(1500);
    expect(t.tutorial.step).toBe(1);
    expect(fb).toHaveBeenLastCalledWith('Hold your hands up at chest height');
    // Together, up, but moving.
    t.stance.lowY = -0.4;
    t.stance.highY = -0.4;
    t.stance.speed = 4;
    t.run(1500);
    expect(t.tutorial.step).toBe(1);
    expect(fb).toHaveBeenLastCalledWith('Hold still for a moment');
    // Still.
    t.stance.speed = 0.5;
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
    expect(t.probe.stance).toBe(false);
  });

  it('a single visible wrist (side-on) is a stance too', () => {
    const t = rig();
    t.stance.tracked = true;
    t.stance.wrists = 1;
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
    t.stance.lowY = -0.3;
    t.stance.highY = -0.3;
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
    expect(t.probe.practice).toBe(true);
  });

  it('practice swings count only when they begin and peak after the step appears', () => {
    const t = rig();
    t.skip();
    t.skip();
    expect(t.tutorial.step).toBe(2);
    // A swing that finished before the step began does not count.
    t.feed.startT = -500;
    t.feed.peakT = -400;
    t.run(2500);
    expect(t.tutorial.step).toBe(2);
    t.feed.startT = t.now + 10;
    t.feed.peakT = t.now + 120;
    t.feed.peakSpeed = 6;
    t.run(2500);
    expect(t.tutorial.step).toBe(3);
  });

  it('surfaces the recognizer reasons as feedback, for a short while', () => {
    const t = rig();
    t.skip();
    t.skip();
    const fb = t.coach.coach.setFeedback;
    t.run(100);
    noteNotice(t.feed, REJECTION_TEXT.slow, t.now);
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Swing faster');
    noteNotice(t.feed, REJECTION_TEXT.steep, t.now);
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Swing across, not up');
    noteNotice(t.feed, REJECTION_TEXT.lost, t.now);
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('I lost your arm, step back a little');
    t.run(t.cfg.noticeMs + 100);
    expect(fb).toHaveBeenLastCalledWith(null);
    t.run(t.cfg.tutorialHintDelayMs);
    expect(fb).toHaveBeenLastCalledWith('Swing your hands fast toward the right of the screen');
  });

  it('the second swing needs real power and shows it', () => {
    const t = rig();
    for (let i = 0; i < 3; i++) t.skip();
    expect(t.tutorial.step).toBe(3);
    const fb = t.coach.coach.setFeedback;
    noteSwingStart(t.feed, t.now + 10);
    noteSwingPeak(t.feed, t.now + 100, t.cfg.powerFloor);
    t.run(200);
    expect(t.tutorial.step).toBe(3);
    expect(fb).toHaveBeenLastCalledWith('A bit gentle. Swing a little faster');
    noteSwingStart(t.feed, t.now + 10);
    noteSwingPeak(t.feed, t.now + 100, t.cfg.powerCeil);
    t.run(2000);
    expect(t.tutorial.step).toBe(4);
    expect(t.coach.praise.at(-1)).toBe('Power 100%');
  });

  it('the timing step starts slow pitches and explains each miss until one is hit', () => {
    const t = rig();
    for (let i = 0; i < 4; i++) t.skip();
    expect(t.tutorial.step).toBe(4);
    expect(t.modes).toEqual(['slow']);
    const fb = t.coach.coach.setFeedback;
    t.setStarted(1);
    noteResult(t.feed, result(1, 'miss', 'early', -200));
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Too early. Swing a little later');
    t.setStarted(2);
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith(null);
    noteResult(t.feed, result(2, 'miss', 'late', 200));
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Too late. Swing a little sooner');
    t.setStarted(3);
    noteResult(t.feed, result(3, 'strike', null));
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('No swing. Swing as the ball reaches the plate');
    expect(t.tutorial.step).toBe(4);
    t.setStarted(4);
    noteResult(t.feed, result(4, 'foul', null, -180));
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Foul, a little early');
    t.setStarted(5);
    noteResult(t.feed, result(5, 'hit', null, 10));
    t.run(2500);
    expect(t.tutorial.step).toBe(5);
    expect(t.modes).toEqual(['slow', 'full']);
  });

  it('the last step ends on a hit, or after three pitches whatever happened', () => {
    const a = rig();
    for (let i = 0; i < 5; i++) a.skip();
    expect(a.tutorial.step).toBe(5);
    a.setStarted(1);
    noteResult(a.feed, result(1, 'hit', null));
    a.run(3000);
    expect(a.tutorial.finished).toBe(true);
    expect(a.finished).toHaveBeenCalledTimes(1);

    const b = rig();
    for (let i = 0; i < 5; i++) b.skip();
    for (let n = 1; n <= 2; n++) {
      b.setStarted(n);
      noteResult(b.feed, result(n, 'miss', 'late', 300));
      b.run(200);
      expect(b.tutorial.finished).toBe(false);
    }
    b.setStarted(3);
    noteResult(b.feed, result(3, 'strike', null));
    b.run(3000);
    expect(b.tutorial.finished).toBe(true);
  });

  it('a hit that lands while the previous step is being praised still counts for it, not the next', () => {
    const t = rig();
    for (let i = 0; i < 4; i++) t.skip();
    t.setStarted(1);
    noteResult(t.feed, result(1, 'hit', null));
    t.run(100); // praise for step 5 begins
    // The next pitch was already planned slow; its hit must not finish the full speed step.
    t.setStarted(2);
    t.run(2500);
    expect(t.tutorial.step).toBe(5);
    noteResult(t.feed, result(2, 'hit', null));
    t.run(200);
    expect(t.tutorial.step).toBe(5);
    t.setStarted(3);
    noteResult(t.feed, result(3, 'hit', null));
    t.run(2500);
    expect(t.tutorial.finished).toBe(true);
  });
});

describe('batting tutorial, mouse steps', () => {
  it('has three steps and explains a miss in click words', () => {
    const t = rig({ mouse: true });
    expect(t.tutorial.stepCount).toBe(3);
    t.run(100);
    expect(t.coach.shown[0]).toBe('Watch a pitch come in');
    expect(t.modes).toEqual(['slow']);
    // Watching ends when a pitch has gone by, whatever happened to it.
    t.setStarted(1);
    noteResult(t.feed, result(1, 'strike', null));
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
    expect(t.coach.shown[1]).toBe('Click as the ball reaches the plate');
    const fb = t.coach.coach.setFeedback;
    t.setStarted(2);
    noteResult(t.feed, result(2, 'strike', null));
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('No click. Click as the ball reaches the plate');
    noteResult(t.feed, result(2, 'miss', 'late', 250));
    t.run(100);
    expect(fb).toHaveBeenLastCalledWith('Too late. Swing a little sooner');
    t.setStarted(3);
    noteResult(t.feed, result(3, 'hit', null));
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
    expect(t.modes).toEqual(['slow', 'slow', 'full']);
    t.setStarted(6);
    for (let n = 4; n <= 6; n++) noteResult(t.feed, result(n, 'strike', null));
    t.run(3000);
    expect(t.tutorial.finished).toBe(true);
  });

  it('a pitch already coming when the click step begins counts for it', () => {
    const t = rig({ mouse: true });
    t.run(100);
    t.setStarted(1);
    noteResult(t.feed, result(1, 'strike', null));
    t.setStarted(2); // the second pitch is already planned (slow) as the praise ends
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
    noteResult(t.feed, result(2, 'hit', null));
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
  });
});

describe('batting tutorial wording', () => {
  it('says the late swing text through the feed', () => {
    const t = rig();
    for (let i = 0; i < 4; i++) t.skip();
    noteNotice(t.feed, SEEN_LATE_TEXT, t.now);
    t.run(100);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Swing seen too late');
  });

  it('skip works on every step and the last skip finishes once', () => {
    const t = rig();
    t.run(10);
    for (let i = 0; i < 6; i++) t.skip();
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.tutorial.dispose();
    expect(t.coach.coach.hide).toHaveBeenCalled();
    expect(t.probe).toEqual({ stance: false, practice: false });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readStance from the arms', () => {
  function fakeState(
    l: { x: number; y: number; speed: number },
    r: { x: number; y: number; speed: number },
    seen: [boolean, boolean],
  ): InputState {
    const pose = new Float32Array(POSE_COUNT * POSE_STRIDE);
    pose[PoseIndex.LEFT_WRIST * POSE_STRIDE + 3] = seen[0] ? 1 : 0;
    pose[PoseIndex.RIGHT_WRIST * POSE_STRIDE + 3] = seen[1] ? 1 : 0;
    const arm = (a: { x: number; y: number; speed: number }) => ({
      wristX: a.x,
      wristY: a.y,
      speed: a.speed,
    });
    return {
      tracking: true,
      hasPose: true,
      shoulderWidth: 0.2,
      aspect: 16 / 9,
      pose,
      arms: { left: arm(l), right: arm(r) },
    } as unknown as InputState;
  }

  it('measures the wrist gap from the shoulder-relative wrists, not the raw pose', () => {
    const v = createStanceView();
    // Both wrists in front of the chest: left one 0.5 sw right of its shoulder, right one 0.5 left.
    readStance(
      fakeState({ x: 0.5, y: -0.3, speed: 0.1 }, { x: -0.5, y: -0.3, speed: 0.4 }, [true, true]),
      0.3,
      v,
    );
    expect(v.tracked).toBe(true);
    expect(v.wrists).toBe(2);
    expect(v.gap).toBeCloseTo(0, 5);
    expect(v.lowY).toBeCloseTo(-0.3, 5);
    expect(v.speed).toBeCloseTo(0.4, 5);
    // Hands at the shoulders' own sides: one shoulder width apart.
    readStance(fakeState({ x: 0, y: 0, speed: 0 }, { x: 0, y: 0, speed: 0 }, [true, true]), 0.3, v);
    expect(v.gap).toBeCloseTo(1, 5);
  });

  it('a single seen wrist has no gap and uses that arm only', () => {
    const v = createStanceView();
    readStance(
      fakeState({ x: 0, y: -2, speed: 9 }, { x: 0.1, y: -0.5, speed: 1 }, [false, true]),
      0.3,
      v,
    );
    expect(v.wrists).toBe(1);
    expect(v.gap).toBe(Infinity);
    expect(v.lowY).toBeCloseTo(-0.5, 5);
    expect(v.speed).toBeCloseTo(1, 5);
  });
});

describe('batting tutorial stance speed limit comes from the config', () => {
  it('holds the step while the speed is at the config limit, and passes just under it', () => {
    const t = rig();
    t.stance.tracked = true;
    t.stance.wrists = 1;
    t.stance.lowY = -0.3;
    t.stance.highY = -0.3;
    t.stance.speed = t.cfg.tutorialStanceMaxSpeed;
    t.skip();
    expect(t.tutorial.step).toBe(1);
    t.run(3000);
    expect(t.tutorial.step).toBe(1);
    t.stance.speed = t.cfg.tutorialStanceMaxSpeed - 0.1;
    t.run(3000);
    expect(t.tutorial.step).toBe(2);
  });
});
