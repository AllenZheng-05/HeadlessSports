// Real recordings. Clips recorded with the debug page's recorder (see tests/recordings/README.md)
// are replayed through the whole input stack and checked by what their file name says they hold.
// With no clips in tests/recordings/ this file checks nothing: that is the state until Allen records.
//
//   batting-<facing|side>-<left|right>-<n>.json   at least one swing: SwingStarted and SwingPeak
//   javelin-jog-<left|right>-<n>.json             at least one overarm throw the javelin rules would
//                                                 accept (fast, over the shoulder, long enough)
//   negative-<anything>.json                      standing, walking in, raising the hands, waggling,
//                                                 jogging with the arms pumping: no swing, no throw
//
// Start every clip facing the camera for a second (the body proportions are learned then), then turn.
// RECORDINGS_VERBOSE=1 prints what every clip produced, to tune the thresholds against.
import { describe, expect, it } from 'vitest';
import { createReplaySource } from '../../tracking/replay/ReplaySource';
import { scriptToClip, validateClip } from '../../tracking/replay/recorder';
import { idle } from '../../tracking/synthetic/scripts/moves';
import { jogSideOn, sideOnSwing, turnToStance } from '../../tracking/synthetic/scripts/profile';
import type { LandmarkClip } from '../../tracking/types';
import { javelinConfig } from '../../sports/javelin/config';
import { requiredThrowSpeed, createGame } from '../../sports/javelin/game';
import { TrackedInput } from '../TrackedInput';
import { ofType } from '../testing/collect';
import type { GameEvent } from '../types';
import { recognizerConfig } from './config';

const files = import.meta.glob<unknown>('/tests/recordings/*.json', {
  eager: true,
  import: 'default',
});

const STEP_MS = 1000 / 60;

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

function replay(clip: LandmarkClip, javelin: boolean): GameEvent[] {
  const saved = { ...recognizerConfig.throw };
  if (javelin) {
    // What the javelin sport sets on start.
    recognizerConfig.throw.maxBodySpeed = javelinConfig.maxBodySpeedOverride;
    recognizerConfig.throw.armSpeed = javelinConfig.recognizerArmSpeed;
    recognizerConfig.throw.armMs = javelinConfig.recognizerArmMs;
  }
  try {
    const source = createReplaySource(clip, { loop: false });
    const input = new TrackedInput(source);
    const events: GameEvent[] = [];
    input.onAny((e) => events.push(e));
    void input.start(clip.needs);
    const last = clip.frames[clip.frames.length - 1]?.t ?? 0;
    for (let t = 0; t <= last + 800; t += STEP_MS) input.update(t);
    input.stop();
    return events;
  } finally {
    Object.assign(recognizerConfig.throw, saved);
  }
}

/** Throws the javelin rules would take at run speed `v` (m/s), for the hand `hand`. */
function javelinTaken(events: GameEvent[], hand: 'left' | 'right', v = 5): GameEvent[] {
  return ofType(events, 'ThrowReleased').filter((e) => {
    const s = createGame(3);
    s.phase = 'run';
    s.speed = v;
    return (
      e.hand === hand &&
      e.speed >= requiredThrowSpeed(s, javelinConfig) &&
      (e.style === 'overarm' || (e.topY ?? -9) >= javelinConfig.minThrowTopY) &&
      (e.travel ?? 9) >= javelinConfig.minThrowTravel
    );
  });
}

const names = Object.keys(files).map(nameOf).sort();

describe('the record and replay path the recordings go through', () => {
  // A clip as the debug page would save it: recorded from a source, written as JSON, read back,
  // validated, replayed through the filters and recognizers. Here the source is synthetic.
  const roundTrip = (clip: LandmarkClip): LandmarkClip =>
    validateClip(JSON.parse(JSON.stringify(clip)));

  it('a recorded side-on swing is seen again on replay', () => {
    const clip = roundTrip(
      scriptToClip(
        {
          name: 'batting-side-left-1',
          steps: [...idle(500), ...turnToStance({}), ...sideOnSwing()],
        },
        { seed: 2 },
      ),
    );
    expect(clip.frames.length).toBeGreaterThan(60);
    const events = replay(clip, false);
    expect(ofType(events, 'SwingStarted')).toHaveLength(1);
    expect(ofType(events, 'SwingPeak')).toHaveLength(1);
  });

  it('a recorded side-on throw while jogging is taken by the javelin rules on replay', () => {
    const clip = roundTrip(
      scriptToClip(
        {
          name: 'javelin-jog-right-1',
          steps: [...idle(400), ...jogSideOn({ ms: 3400, throwHand: 'right', throwAtMs: 1800 })],
        },
        { seed: 3 },
      ),
    );
    expect(javelinTaken(replay(clip, true), 'right')).toHaveLength(1);
  });
});

describe('recorded clips', () => {
  it(`${names.length} clips in tests/recordings/ (none yet is fine)`, () => {
    expect(names.length).toBeGreaterThanOrEqual(0);
  });

  for (const path of Object.keys(files).sort()) {
    const name = nameOf(path);
    const clip = validateClip(files[path]);
    if (clip.origin !== 'camera') continue; // synthetic placeholders are checked elsewhere
    const verbose = typeof process !== 'undefined' && process.env.RECORDINGS_VERBOSE === '1';

    if (name.startsWith('batting-')) {
      it(`${name}: a swing is seen`, () => {
        const events = replay(clip, false);
        if (verbose) console.info(name, summary(events));
        expect(ofType(events, 'SwingStarted').length).toBeGreaterThanOrEqual(1);
        expect(ofType(events, 'SwingPeak').length).toBeGreaterThanOrEqual(1);
      });
    } else if (name.startsWith('javelin-')) {
      const hand = name.includes('-left-') ? 'left' : 'right';
      it(`${name}: an overarm throw is taken`, () => {
        const events = replay(clip, true);
        if (verbose) console.info(name, summary(events));
        expect(javelinTaken(events, hand).length).toBeGreaterThanOrEqual(1);
      });
    } else if (name.startsWith('negative-')) {
      it(`${name}: no swing and no throw`, () => {
        const events = replay(clip, true);
        if (verbose) console.info(name, summary(events));
        expect(ofType(events, 'SwingStarted')).toEqual([]);
        expect(javelinTaken(events, 'left')).toEqual([]);
        expect(javelinTaken(events, 'right')).toEqual([]);
      });
    }
  }
});

function summary(events: GameEvent[]): string {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === 'SwingStarted' || e.type === 'SwingPeak') {
      out.push(`${e.type} t=${e.t.toFixed(0)} speed=${e.speed.toFixed(1)}`);
    } else if (e.type === 'ThrowReleased') {
      out.push(
        `Throw ${e.hand} t=${e.t.toFixed(0)} speed=${e.speed.toFixed(1)} ${e.style} top=${e.topY?.toFixed(2)} travel=${e.travel?.toFixed(2)}`,
      );
    }
  }
  return out.join('\n  ');
}
