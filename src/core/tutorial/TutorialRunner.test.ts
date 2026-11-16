import { describe, expect, it, vi } from 'vitest';
import type { Coach } from '../sport';
import { TutorialRunner } from './TutorialRunner';
import type { TutorialStep } from './TutorialRunner';

function fakeCoach() {
  let skip: (() => void) | null = null;
  const unregister = vi.fn(() => {
    skip = null;
  });
  const coach = {
    show: vi.fn(),
    setFeedback: vi.fn(),
    confirm: vi.fn(),
    onSkip: vi.fn((handler: () => void) => {
      skip = handler;
      return unregister;
    }),
    hide: vi.fn(),
  } satisfies Coach;
  return { coach, unregister, pressSkip: () => skip?.() };
}

function step(over: Partial<TutorialStep> = {}): TutorialStep {
  return { text: 'Do it', done: () => false, ...over };
}

describe('TutorialRunner', () => {
  it('shows the first step on the first update with its detail', () => {
    const { coach } = fakeCoach();
    const r = new TutorialRunner(
      coach,
      [step({ text: 'One', detail: 'More' }), step({ text: 'Two' })],
      () => undefined,
    );
    expect(coach.show).not.toHaveBeenCalled();
    r.update(1000);
    expect(coach.show).toHaveBeenCalledWith(0, 2, 'One', 'More');
    r.update(1016);
    expect(coach.show).toHaveBeenCalledTimes(1);
    expect(r.index).toBe(0);
  });

  it('textNow and detailNow are read once, after enter, and replace the static text', () => {
    const { coach } = fakeCoach();
    let state = 'a';
    const textNow = vi.fn(() => `now ${state}`);
    const r = new TutorialRunner(
      coach,
      [
        step({
          text: 'Static',
          detail: 'Static detail',
          enter: () => {
            state = 'b';
          },
          textNow,
          detailNow: () => `detail ${state}`,
        }),
        step({ text: 'Plain', detail: 'Plain detail', textNow: () => undefined }),
      ],
      () => undefined,
    );
    r.update(0);
    r.update(16);
    expect(coach.show).toHaveBeenCalledTimes(1);
    expect(coach.show).toHaveBeenCalledWith(0, 2, 'now b', 'detail b');
    expect(textNow).toHaveBeenCalledTimes(1);
    // Returning undefined keeps the static text.
    r.update(20);
    // Skip to the second step.
    const skipper = fakeCoach();
    const r2 = new TutorialRunner(
      skipper.coach,
      [
        step({ text: 'X' }),
        step({ text: 'Plain', detail: 'Plain detail', textNow: () => undefined }),
      ],
      () => undefined,
    );
    r2.update(0);
    skipper.pressSkip();
    r2.update(10);
    r2.update(20);
    expect(skipper.coach.show).toHaveBeenLastCalledWith(1, 2, 'Plain', 'Plain detail');
  });

  it('calls enter once when a step becomes current', () => {
    const { coach } = fakeCoach();
    const enter = vi.fn();
    const r = new TutorialRunner(coach, [step({ enter, done: () => true })], () => undefined);
    r.update(0);
    r.update(500);
    r.update(900);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('cannot complete before minShowMs, even when the condition is already true', () => {
    const { coach } = fakeCoach();
    const r = new TutorialRunner(coach, [step({ done: () => true })], () => undefined, {
      minShowMs: 800,
      confirmMs: 900,
    });
    r.update(1000);
    r.update(1799);
    expect(coach.confirm).not.toHaveBeenCalled();
    r.update(1800);
    expect(coach.confirm).toHaveBeenCalledTimes(1);
  });

  it('latches a condition that was only true for a moment during the minimum show time', () => {
    const { coach } = fakeCoach();
    let on = true;
    const r = new TutorialRunner(coach, [step({ done: () => on })], () => undefined);
    r.update(0);
    on = false;
    r.update(900);
    expect(coach.confirm).toHaveBeenCalledTimes(1);
  });

  it('shows the praise for confirmMs, then enters the next step', () => {
    const { coach } = fakeCoach();
    const r = new TutorialRunner(
      coach,
      [step({ done: () => true, praise: 'Great' }), step({ text: 'Two' })],
      () => undefined,
    );
    r.update(0);
    r.update(800);
    expect(coach.confirm).toHaveBeenCalledWith('Great');
    r.update(1699);
    expect(r.index).toBe(0);
    r.update(1700);
    expect(r.index).toBe(1);
    r.update(1716);
    expect(coach.show).toHaveBeenLastCalledWith(1, 2, 'Two', null);
  });

  it('uses the default praise when the step has none', () => {
    const { coach } = fakeCoach();
    const r = new TutorialRunner(coach, [step({ done: () => true })], () => undefined);
    r.update(0);
    r.update(800);
    expect(coach.confirm).toHaveBeenCalledWith(undefined);
  });

  it('skip advances at once, without praise, and ignores minShowMs', () => {
    const { coach, pressSkip } = fakeCoach();
    const enter2 = vi.fn();
    const r = new TutorialRunner(
      coach,
      [step(), step({ text: 'Two', enter: enter2 })],
      () => undefined,
    );
    r.update(0);
    pressSkip();
    r.update(16);
    expect(r.index).toBe(1);
    expect(coach.confirm).not.toHaveBeenCalled();
    r.update(32);
    expect(enter2).toHaveBeenCalledTimes(1);
    expect(coach.show).toHaveBeenLastCalledWith(1, 2, 'Two', null);
  });

  it('skip during the praise moves on without waiting', () => {
    const { coach, pressSkip } = fakeCoach();
    const r = new TutorialRunner(coach, [step({ done: () => true }), step()], () => undefined);
    r.update(0);
    r.update(800);
    pressSkip();
    r.update(816);
    expect(r.index).toBe(1);
  });

  it('finishes exactly once after the last step, and on skipping the last step', () => {
    const { coach, pressSkip } = fakeCoach();
    const onFinished = vi.fn();
    const r = new TutorialRunner(coach, [step({ done: () => true }), step()], onFinished);
    r.update(0);
    r.update(800);
    r.update(1700);
    expect(onFinished).not.toHaveBeenCalled();
    r.update(1716);
    pressSkip();
    r.update(1732);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(r.finished).toBe(true);
    expect(r.index).toBe(2);
    pressSkip();
    r.update(5000);
    r.update(6000);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('finishes straight away with no steps', () => {
    const { coach } = fakeCoach();
    const onFinished = vi.fn();
    const r = new TutorialRunner(coach, [], onFinished);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(r.finished).toBe(true);
    r.update(0);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('only writes feedback when the string changes', () => {
    const { coach } = fakeCoach();
    let text: string | null = 'Close your fist';
    const r = new TutorialRunner(coach, [step({ feedback: () => text })], () => undefined);
    r.update(0); // entering clears the feedback and then reports the first line
    coach.setFeedback.mockClear();
    r.update(16);
    r.update(32);
    r.update(48);
    expect(coach.setFeedback).not.toHaveBeenCalled();
    text = 'Move closer';
    r.update(64);
    r.update(80);
    expect(coach.setFeedback).toHaveBeenCalledTimes(1);
    expect(coach.setFeedback).toHaveBeenLastCalledWith('Move closer');
    text = null;
    r.update(96);
    expect(coach.setFeedback).toHaveBeenLastCalledWith(null);
    r.update(112);
    expect(coach.setFeedback).toHaveBeenCalledTimes(2);
  });

  it('clears the feedback when the step completes and when the next step starts', () => {
    const { coach } = fakeCoach();
    let ok = false;
    const r = new TutorialRunner(
      coach,
      [step({ done: () => ok, feedback: () => 'Not yet' }), step()],
      () => undefined,
    );
    r.update(0);
    r.update(16);
    expect(coach.setFeedback).toHaveBeenLastCalledWith('Not yet');
    ok = true;
    r.update(900);
    expect(coach.setFeedback).toHaveBeenLastCalledWith(null);
    r.update(1800);
    r.update(1816);
    expect(r.index).toBe(1);
    expect(coach.setFeedback).toHaveBeenLastCalledWith(null);
  });

  it('is deterministic on the time it is given', () => {
    const run = (): string[] => {
      const { coach } = fakeCoach();
      const log: string[] = [];
      coach.show.mockImplementation((i: number) => log.push(`show${i}`));
      coach.confirm.mockImplementation(() => log.push('confirm'));
      const r = new TutorialRunner(
        coach,
        [step({ done: (t) => t > 2000 }), step({ done: (t) => t > 6000 })],
        () => log.push('end'),
      );
      for (let t = 0; t < 9000; t += 16) r.update(t);
      return log;
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual(['show0', 'confirm', 'show1', 'confirm', 'end']);
  });

  it('dispose unregisters the skip handler, hides the panel and stops updating', () => {
    const { coach, unregister } = fakeCoach();
    const r = new TutorialRunner(coach, [step({ done: () => true })], () => undefined);
    r.update(0);
    r.dispose();
    r.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(coach.hide).toHaveBeenCalledTimes(1);
    r.update(5000);
    expect(coach.confirm).not.toHaveBeenCalled();
  });
});
