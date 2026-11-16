import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import type { Coach } from '../../core/sport';
import { syntheticCalibration } from '../../input/testing/runScript';
import { TrackedInput } from '../../input/TrackedInput';
import { createSyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import { idle } from '../../tracking/synthetic/scripts/moves';
import {
  DampedValue,
  bowArmUp,
  otherSide,
  targetPitch,
  targetYaw,
  wristDistanceRawException,
  wristMinVisibility,
} from './aim';
import { createArcheryBot } from './bot';
import type { TutorialProbe } from './bot';
import { archeryConfig } from './config';
import { DrawMachine, StepEvent } from './draw';
import type { DrawSample } from './draw';
import { Arrow, ArrowState, basePitch, hitOnPlane } from './flight';
import type { Hit } from './flight';
import { ArcheryRound } from './round';
import { ringScore } from './target';
import { createArcheryTutorial } from './tutorial';
import type { TutorialView } from './tutorial';

const cfg = { ...archeryConfig };

function fakeCoach() {
  let skip: (() => void) | null = null;
  const shown: string[] = [];
  const coach = {
    show: vi.fn((_i: number, _n: number, text: string) => {
      shown.push(text);
    }),
    setFeedback: vi.fn(),
    confirm: vi.fn(),
    onSkip: vi.fn((h: () => void) => {
      skip = h;
      return () => undefined;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, shown, pressSkip: () => skip?.() };
}

/** Facts a test sets by hand. */
interface Facts {
  tracked: boolean;
  bowUp: boolean;
  phase: string;
  draw: number;
  lost: boolean;
  aimOff: number;
  launched: number;
  impacts: number;
}

function rig(mouse = false) {
  const facts: Facts = {
    tracked: true,
    bowUp: true,
    phase: 'ready',
    draw: 0,
    lost: false,
    aimOff: 5,
    launched: 0,
    impacts: 0,
  };
  const view: TutorialView = {
    tracked: () => facts.tracked,
    bowUp: () => facts.bowUp,
    phase: () => facts.phase,
    draw: () => facts.draw,
    lost: () => facts.lost,
    aimOff: () => facts.aimOff,
    launched: () => facts.launched,
    impacts: () => facts.impacts,
  };
  const probe: TutorialProbe = { hold: false };
  const finished = vi.fn();
  const coach = fakeCoach();
  const tutorial = createArcheryTutorial({
    cfg,
    coach: coach.coach,
    mouse,
    view,
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
  return { facts, probe, finished, coach, tutorial, run };
}

/** The whole loop without a browser: the bot, the real draw machine, flight and the tutorial. */
function simulate(seed: number, seconds: number) {
  const drawHand = 'right' as const;
  const bowHand = otherSide(drawHand);
  const source = createSyntheticSource({
    script: { name: 'bot', steps: idle(100) },
    noise: { seed, sigma: 0.0015 },
  });
  const input = new TrackedInput(source);
  input.setCalibration({ ...syntheticCalibration(), handedness: drawHand });
  const machine = new DrawMachine(cfg);
  input.on('FistClosed', (e) => {
    if (e.hand === drawHand) machine.noteClosed();
  });
  input.on('FistOpened', (e) => {
    if (e.hand === drawHand) machine.noteOpened(e.t);
  });
  const round = new ArcheryRound(cfg.tutorialArrows);
  const arrow = new Arrow();
  const hit: Hit = { x: 0, y: 0, t: 0 };
  const tutHit: Hit = { x: 0, y: 0, t: 0 };
  const base = basePitch(cfg);
  const backZ = -cfg.targetDistance - 1.45;
  const yawF = new DampedValue();
  const pitchF = new DampedValue();
  let frozenYaw = 0;
  let frozenPitch = 0;
  let phase = 'ready';
  let showMs = 0;
  let hitX = 0;
  let hitY = 0;
  let aimOff = 0;
  let launched = 0;
  let trackedNow = false;
  let bowUpNow = false;
  let firstLaunchStep = -1;
  let finishedAt = -1;
  let now = 0;
  const probe: TutorialProbe = { hold: false };
  const { coach, shown } = fakeCoach();
  const tutorial = createArcheryTutorial({
    cfg,
    coach,
    mouse: false,
    probe,
    view: {
      tracked: () => trackedNow,
      bowUp: () => bowUpNow,
      phase: () => phase,
      draw: () => machine.draw,
      lost: () => phase === 'drawing' && !machine.tracking,
      aimOff: () => aimOff,
      launched: () => launched,
      impacts: () => round.taken,
    },
    onFinished: () => {
      finishedAt = now;
    },
  });
  const bot = createArcheryBot(
    {
      get phase() {
        return phase;
      },
      get draw() {
        return machine.draw;
      },
      get hitX() {
        return hitX;
      },
      get hitY() {
        return hitY;
      },
      get arrowsShot() {
        return round.taken;
      },
    },
    cfg,
    drawHand,
    mulberry32(seed + 1000),
    probe,
  );
  source.setDirector((_q, rel) => bot.next((steps) => source.queue?.enqueue(steps), rel));
  void input.start({ pose: true, handCrops: true, fullFrameHands: false });

  const sample: DrawSample = {
    valid: false,
    bowUp: false,
    dist: 0,
    minVis: 0,
    present: false,
    known: false,
    closed: false,
    yaw: 0,
    pitch: 0,
  };
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60 && finishedAt < 0; i++) {
    now = (i * 1000) / 60;
    input.update(now);
    const s = input.state;
    if (phase === 'flying') {
      for (let k = 0; k < 2 && phase === 'flying'; k++) {
        if (
          arrow.step(dt / 2, cfg, cfg.targetRadius + cfg.lineTolerance, backZ) !== ArrowState.Flying
        ) {
          const stuck = arrow.state === ArrowState.Stuck;
          const r = Math.hypot(arrow.planeX, arrow.planeY - cfg.targetHeight);
          const ring =
            arrow.crossed && stuck ? ringScore(r, cfg.targetRadius, cfg.lineTolerance) : 0;
          round.record(ring, r);
          tutorial.noteImpact(ring);
          showMs = 0;
          phase = 'showing';
        }
      }
    } else if (phase === 'showing') {
      showMs += dt * 1000;
      if (showMs >= cfg.showHitMs) {
        machine.unlock();
        phase = 'ready';
      }
    }
    const bowArm = s.arms[bowHand];
    const dh = s.hands[drawHand];
    const dist = wristDistanceRawException(
      s.pose,
      s.aspect,
      s.shoulderWidth,
      cfg.minWristVisibility,
    );
    const valid = s.hasPose && s.tracking && dist >= 0;
    const bowUp = valid && bowArmUp(bowArm.wristX, bowArm.wristY, cfg, machine.phase === 'drawing');
    if (bowUp) {
      frozenYaw = targetYaw(bowArm.wristX, bowHand, cfg);
      frozenPitch = targetPitch(bowArm.wristY, cfg);
    }
    yawF.update(frozenYaw, dt, cfg.aimSmoothS);
    pitchF.update(frozenPitch, dt, cfg.aimSmoothS);
    trackedNow = valid;
    bowUpNow = bowUp;
    sample.valid = valid;
    sample.bowUp = bowUp;
    sample.dist = dist;
    sample.minVis = wristMinVisibility(s.pose);
    sample.present = dh.present;
    sample.known = dh.known;
    sample.closed = dh.closed;
    sample.yaw = yawF.value;
    sample.pitch = pitchF.value;
    const ev = machine.step(dt, now, sample);
    if (ev === StepEvent.Nock || ev === StepEvent.AutoNock) phase = 'drawing';
    else if (ev === StepEvent.Unnock || ev === StepEvent.Cancel) phase = 'ready';
    else if (ev === StepEvent.Shot) {
      arrow.launch(cfg, base, machine.shot.draw, machine.shot.yaw, machine.shot.pitch, 0);
      launched++;
      if (firstLaunchStep < 0) firstLaunchStep = tutorial.step;
      phase = 'flying';
    }
    hitOnPlane(cfg, base, 1, yawF.value, pitchF.value, 0, tutHit);
    aimOff = Math.hypot(tutHit.x, tutHit.y - cfg.targetHeight);
    if (phase === 'drawing') {
      hitOnPlane(cfg, base, machine.draw, yawF.value, pitchF.value, 0, hit);
      hitX = hit.x;
      hitY = hit.y - cfg.targetHeight;
    } else {
      hitX = 0;
      hitY = 0;
    }
    tutorial.update(now);
  }
  input.stop();
  return { finishedAt, shown, launched, taken: round.taken, firstLaunchStep, probe };
}

describe('archery tutorial (camera), closed loop', () => {
  it('the bot completes every step on four seeds, holding its draw until the shoot step', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = simulate(seed, 120);
      expect(r.finishedAt, `seed ${seed}`).toBeGreaterThan(0);
      expect(r.shown.length, `seed ${seed}`).toBe(7);
      expect(r.taken, `seed ${seed}`).toBeGreaterThanOrEqual(1 + cfg.tutorialMoreShots);
      // No arrow left before the "Open your hand to shoot" step (index 5).
      expect(r.firstLaunchStep, `seed ${seed}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('shows the steps in the planned order, one short line each', () => {
    const r = simulate(1, 120);
    expect(r.shown).toEqual([
      'Stand so I can see your shoulders and both hands',
      'Hold your bow arm out to the side',
      'Bring your other hand to your bow hand and make a fist',
      'Pull your fist back toward your shoulder',
      'Move your bow arm to aim',
      'Open your hand to shoot',
      'Shoot two more',
    ]);
    for (const line of r.shown) expect(line.length).toBeLessThan(60);
  });
});

describe('archery tutorial (camera), steps', () => {
  it('step 1 waits for the tracked body and says so only after a pause', () => {
    const t = rig();
    t.facts.tracked = false;
    t.run(1000);
    const fb = t.coach.coach.setFeedback;
    expect(fb).toHaveBeenLastCalledWith(null);
    t.run(2000);
    expect(fb).toHaveBeenLastCalledWith("I can't see your hands yet");
    expect(t.tutorial.step).toBe(0);
    t.facts.tracked = true;
    t.run(800);
    expect(t.coach.coach.confirm).toHaveBeenCalledTimes(1);
  });

  it('the bow arm step needs the arm up for a moment', () => {
    const t = rig();
    t.run(2000); // step 1 done, praised
    expect(t.tutorial.step).toBe(1);
    t.facts.bowUp = false;
    t.run(3000);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Raise your arm to shoulder height');
    expect(t.tutorial.step).toBe(1);
    t.facts.bowUp = true;
    t.run(2000);
    expect(t.tutorial.step).toBe(2);
  });

  it('a nock or full draw that happens during the praise is not missed', () => {
    const t = rig();
    t.run(4000); // steps 1 and 2 done
    expect(t.tutorial.step).toBe(2);
    t.facts.phase = 'drawing';
    t.facts.draw = 1;
    t.run(100);
    t.facts.phase = 'ready'; // let down again before the next step even shows
    t.facts.draw = 0;
    t.run(5000);
    // Nocked and fully drawn once: steps 3 and 4 are both behind us.
    expect(t.tutorial.step).toBeGreaterThanOrEqual(4);
  });

  it('the aim step needs the circle on the target for a while, while drawn', () => {
    const t = rig();
    t.facts.phase = 'drawing';
    t.facts.draw = 1;
    t.run(7000);
    expect(t.tutorial.step).toBe(4);
    t.facts.aimOff = 0.2;
    t.run(300);
    expect(t.tutorial.step).toBe(4);
    t.facts.aimOff = 3;
    t.run(400);
    t.facts.aimOff = 0.2;
    t.run(600);
    expect(t.tutorial.step).toBe(4);
    t.run(1200);
    expect(t.tutorial.step).toBe(5);
  });

  it('a lost hand is reassured, not blamed', () => {
    const t = rig();
    t.facts.phase = 'drawing';
    t.facts.draw = 0.5;
    t.run(6000);
    expect(t.tutorial.step).toBe(3);
    t.facts.lost = true;
    t.run(200);
    expect(t.coach.coach.setFeedback).not.toHaveBeenLastCalledWith(
      'I lost your hand. Hold on, the draw is safe',
    );
    t.run(400);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith(
      'I lost your hand. Hold on, the draw is safe',
    );
    t.facts.lost = false;
    t.run(100);
    expect(t.coach.coach.setFeedback).not.toHaveBeenLastCalledWith(
      'I lost your hand. Hold on, the draw is safe',
    );
  });

  it('the shoot step lets the bot go, and the last step praises the ring', () => {
    const t = rig();
    expect(t.probe.hold).toBe(true);
    t.facts.phase = 'drawing';
    t.facts.draw = 1;
    t.facts.aimOff = 0;
    t.run(12000);
    expect(t.tutorial.step).toBe(5);
    expect(t.probe.hold).toBe(false);
    t.facts.launched = 1;
    t.facts.phase = 'flying';
    t.run(2500);
    expect(t.tutorial.step).toBe(6);
    t.tutorial.noteImpact(8);
    t.facts.impacts = 1;
    t.run(500);
    expect(t.tutorial.step).toBe(6);
    t.tutorial.noteImpact(10);
    t.facts.impacts = 3;
    t.run(900);
    expect(t.coach.coach.confirm).toHaveBeenLastCalledWith('Bullseye, 10');
    t.run(2500);
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
  });

  it('skipping every step finishes once, and dispose hides the panel', () => {
    const t = rig();
    t.tutorial.update(0);
    for (let i = 0; i < 7; i++) {
      t.coach.pressSkip();
      t.tutorial.update(100 + i * 16);
      t.tutorial.update(110 + i * 16);
    }
    expect(t.tutorial.finished).toBe(true);
    expect(t.finished).toHaveBeenCalledTimes(1);
    t.tutorial.dispose();
    expect(t.coach.coach.hide).toHaveBeenCalled();
    expect(t.probe.hold).toBe(false);
  });
});

describe('archery tutorial (mouse)', () => {
  it('has four steps that name the mouse actions', () => {
    const t = rig(true);
    expect(t.tutorial.stepCount).toBe(4);
    t.tutorial.update(0);
    expect(t.coach.shown[0]).toBe('Move the mouse onto the target');
    t.run(3000);
    expect(t.coach.coach.setFeedback).toHaveBeenLastCalledWith('Move the pointer over the target');
  });

  it('aim, draw full, shoot, then two more', () => {
    const t = rig(true);
    t.facts.aimOff = 0.1;
    t.run(2500);
    expect(t.tutorial.step).toBe(1);
    t.facts.phase = 'drawing';
    t.facts.draw = 1;
    t.run(2500);
    expect(t.tutorial.step).toBe(2);
    expect(t.probe.hold).toBe(false);
    t.facts.launched = 1;
    t.facts.phase = 'flying';
    t.run(2500);
    expect(t.tutorial.step).toBe(3);
    t.facts.impacts = 3;
    t.run(3000);
    expect(t.tutorial.finished).toBe(true);
  });
});

describe('archery tutorial, "shoot two more" counts from the step', () => {
  it('after skipping the shoot step it needs exactly two landed arrows, camera and mouse', () => {
    for (const mouse of [false, true]) {
      const t = rig(mouse);
      t.tutorial.update(0);
      const last = t.tutorial.stepCount - 1;
      // Skip up to the last step with no arrow shot: exactly two landed arrows are needed.
      for (let i = 0; i < last; i++) {
        t.coach.pressSkip();
        t.run(100);
      }
      expect(t.tutorial.step, `mouse ${mouse}`).toBe(last);
      t.run(1000);
      t.facts.launched = 1;
      t.facts.impacts = 1;
      t.run(1000);
      expect(t.tutorial.step, `one landed, mouse ${mouse}`).toBe(last);
      t.facts.launched = 2;
      t.facts.impacts = 2;
      t.run(1000);
      expect(t.tutorial.finished, `two landed, mouse ${mouse}`).toBe(true);
    }
  });

  it('an arrow loosed during the shoot step does not count toward the two more', () => {
    const t = rig(true);
    t.facts.aimOff = 0.1;
    t.run(2500);
    t.facts.phase = 'drawing';
    t.facts.draw = 1;
    t.run(2500);
    t.facts.launched = 1;
    t.facts.phase = 'flying';
    t.run(2500);
    expect(t.tutorial.step).toBe(3);
    // The first arrow lands after the last step began: that is not one of the two.
    t.facts.impacts = 1;
    t.run(1000);
    t.facts.launched = 2;
    t.facts.impacts = 2;
    t.run(1000);
    expect(t.tutorial.finished).toBe(false);
    t.facts.launched = 3;
    t.facts.impacts = 3;
    t.run(1000);
    expect(t.tutorial.finished).toBe(true);
  });
});
