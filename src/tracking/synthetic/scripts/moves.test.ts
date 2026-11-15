import { describe, expect, it } from 'vitest';
import { PoseIndex } from '../../types';
import type { LandmarkFrame, TrackerNeeds } from '../../types';
import { SyntheticBody, createEmptyFrame } from '../body';
import { defaultControls } from '../controls';
import { ScriptPlayer } from '../script';
import type { Script, ScriptStep } from '../script';
import { createSyntheticSource } from '../SyntheticSource';
import { getScript, listScripts } from './index';
import * as moves from './moves';

const ASPECT = 16 / 9;
const SW = 0.13;
const FPS = 30;
const ALL_NEEDS: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: true };

/** Sample a script at 30 Hz with noise off and hand the frames to `visit`. */
function track(script: Script, visit: (f: LandmarkFrame, t: number) => void): void {
  const player = new ScriptPlayer(script);
  const body = new SyntheticBody(ASPECT, { sigma: 0, seed: 1 });
  const controls = defaultControls();
  const frame = createEmptyFrame(ASPECT);
  for (let t = 0; t <= player.durationMs; t += 1000 / FPS) {
    player.sample(t, controls);
    body.write(controls, frame);
    visit(frame, t);
  }
}

/** Wrist speed in sw/s from successive frames. */
function wristSpeeds(script: Script, index: number): number[] {
  const speeds: number[] = [];
  let px = NaN;
  let py = NaN;
  track(script, (f) => {
    const x = f.pose[index * 4] * ASPECT;
    const y = f.pose[index * 4 + 1];
    if (!Number.isNaN(px)) speeds.push((Math.hypot(x - px, y - py) / SW) * FPS);
    px = x;
    py = y;
  });
  return speeds;
}

/** Indices of local maxima at or above `threshold`. */
function peakIndices(values: number[], threshold: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= threshold && values[i] > values[i - 1] && values[i] >= values[i + 1])
      out.push(i);
  }
  return out;
}

function peaksAbove(values: number[], threshold: number): number {
  return peakIndices(values, threshold).length;
}

function runToEnd(script: Script): LandmarkFrame[] {
  const source = createSyntheticSource({ script });
  const copies: LandmarkFrame[] = [];
  source.subscribe((f) => {
    for (const v of f.pose) if (!Number.isFinite(v)) throw new Error('non-finite pose');
    for (const v of f.poseWorld) if (!Number.isFinite(v)) throw new Error('non-finite world');
    for (const h of f.hands)
      for (const v of h.landmarks) if (!Number.isFinite(v)) throw new Error('non-finite hand');
    copies.push({ ...f });
  });
  void source.start(ALL_NEEDS);
  const duration = new ScriptPlayer(script).durationMs;
  for (let k = 0; (k * 1000) / FPS <= duration + 100; k++) source.pump((k * 1000) / FPS);
  if (script.loop !== true) expect(source.finished).toBe(true);
  return copies;
}

describe('moves', () => {
  const primitives: [string, ScriptStep[]][] = [
    ['idle', moves.idle(500)],
    ['closeFist', moves.closeFist('left')],
    ['openFist', moves.openFist('right', 400)],
    ['raiseArm', moves.raiseArm('right', { fist: true, holdMs: 300 })],
    ['raiseArm left', moves.raiseArm('left')],
    ['underarmSwing', moves.underarmSwing('right', { power: 0.6, lateral: 0.2, curve: 0.5 })],
    ['underarmSwing left', moves.underarmSwing('left')],
    ['overarmThrow', moves.overarmThrow('right', { power: 0.7, loftDeg: 50, lateral: -0.1 })],
    ['overarmThrow left', moves.overarmThrow('left')],
    ['twoHandSwing', moves.twoHandSwing()],
    ['twoHandSwing reverse', moves.twoHandSwing({ direction: -1, power: 0.3, height: 0.1 })],
    ['runInPlace', moves.runInPlace({ steps: 5, stepsPerSecond: 3, amplitude: 1 })],
    ['jogInPlace', moves.jogInPlace({ steps: 6, stepsPerSecond: 3 })],
    ['jogInPlace arms held', moves.jogInPlace({ steps: 4, stepsPerSecond: 4, hold: 'right' })],
    ['leanTo', moves.leanTo(0.25)],
    ['sidestep', moves.sidestep(0.3)],
    ['squat', moves.squat()],
    ['jumpUp', moves.jumpUp()],
    ['drawBow', moves.drawBow('left', { draw: 0.8, holdMs: 400 })],
    ['drawBow right', moves.drawBow('right', { aimX: -1.2, aimY: 0.3 })],
  ];

  it.each(primitives)('%s runs to completion with finite coordinates', (name, steps) => {
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.dur).toBeGreaterThan(0);
    runToEnd({ name, steps });
  });

  it('climbPull runs in hands-only mode', () => {
    const steps = [
      ...moves.climbPull('left', { reachX: 0.4, reachY: 0.3, pullBy: 0.2 }),
      ...moves.climbPull('right', { reachX: 0.6, reachY: 0.3, pullBy: 0.2, ms: 700 }),
    ];
    const frames = runToEnd({ name: 'climb', start: moves.handsOnlyStart(), steps });
    expect(frames.every((f) => !f.hasPose)).toBe(true);
    expect(frames.every((f) => f.hands[0].present && f.hands[1].present)).toBe(true);
  });

  it('slow gestures take 300 ms or more', () => {
    for (const s of [...moves.closeFist('left'), ...moves.openFist('left')]) {
      expect(s.dur).toBeGreaterThanOrEqual(300);
    }
  });

  it('underarmSwing has one dominant wrist-speed peak of 6 to 9 sw/s at full power', () => {
    const speeds = wristSpeeds(
      { name: 'u', steps: moves.underarmSwing('right') },
      PoseIndex.RIGHT_WRIST,
    );
    const peak = Math.max(...speeds);
    console.info(`underarmSwing peak ${peak.toFixed(2)} sw/s`);
    expect(peak).toBeGreaterThan(6);
    expect(peak).toBeLessThan(9);
    expect(peaksAbove(speeds, peak * 0.5)).toBe(1);
  });

  it('underarmSwing power scales the peak speed', () => {
    const peak = (power: number): number =>
      Math.max(...wristSpeeds({ name: 'u', steps: moves.underarmSwing('right', { power }) }, 16));
    expect(peak(0.4)).toBeLessThan(peak(1) * 0.8);
  });

  it('overarmThrow has one dominant wrist-speed peak of 8 to 12 sw/s at full power', () => {
    const speeds = wristSpeeds(
      { name: 'o', steps: moves.overarmThrow('right') },
      PoseIndex.RIGHT_WRIST,
    );
    const peak = Math.max(...speeds);
    console.info(`overarmThrow peak ${peak.toFixed(2)} sw/s`);
    expect(peak).toBeGreaterThan(8);
    expect(peak).toBeLessThan(12);
    expect(peaksAbove(speeds, peak * 0.5)).toBe(1);
  });

  it('the left-handed versions mirror the right-handed ones', () => {
    const l = wristSpeeds({ name: 'o', steps: moves.overarmThrow('left') }, PoseIndex.LEFT_WRIST);
    const r = wristSpeeds({ name: 'o', steps: moves.overarmThrow('right') }, PoseIndex.RIGHT_WRIST);
    expect(Math.max(...l)).toBeCloseTo(Math.max(...r), 1);
  });

  it('twoHandSwing keeps the wrists together and peaks around 8 to 14 sw/s', () => {
    const script: Script = { name: 'b', steps: moves.twoHandSwing() };
    track(script, (f, t) => {
      if (t < 600) return;
      const dx = ((f.pose[16 * 4] - f.pose[15 * 4]) * ASPECT) / SW;
      const dy = (f.pose[16 * 4 + 1] - f.pose[15 * 4 + 1]) / SW;
      expect(Math.hypot(dx, dy)).toBeLessThan(0.05);
    });
    const speeds = wristSpeeds(script, PoseIndex.RIGHT_WRIST);
    const peak = Math.max(...speeds);
    console.info(`twoHandSwing peak ${peak.toFixed(2)} sw/s`);
    expect(peak).toBeGreaterThan(8);
    expect(peak).toBeLessThan(14);
    expect(peaksAbove(speeds, peak * 0.5)).toBe(1);
  });

  it('runInPlace lifts the knees alternately, the requested number of times', () => {
    const script: Script = { name: 'r', steps: moves.runInPlace({ steps: 6, stepsPerSecond: 3 }) };
    const left: number[] = [];
    const right: number[] = [];
    let hip = 0;
    track(script, (f) => {
      hip = f.pose[PoseIndex.LEFT_HIP * 4 + 1];
      left.push(f.pose[PoseIndex.LEFT_KNEE * 4 + 1]);
      right.push(f.pose[PoseIndex.RIGHT_KNEE * 4 + 1]);
    });
    const stand = left[0];
    // Lift height as a fraction of the way from standing to hip height; amplitude 0.8 reaches 0.8.
    const liftOf = (series: number[]): number[] => series.map((y) => (stand - y) / (stand - hip));
    const lifts: { i: number; side: string }[] = [];
    for (const [side, series] of [
      ['left', left],
      ['right', right],
    ] as const) {
      for (const i of peakIndices(liftOf(series), 0.5)) lifts.push({ i, side });
    }
    expect(lifts).toHaveLength(6);
    lifts.sort((p, q) => p.i - q.i);
    lifts.forEach((l, k) => expect(l.side).toBe(k % 2 === 0 ? 'left' : 'right'));
  });

  it('squat drops the hips and jumpUp lifts the feet', () => {
    let hipMax = 0;
    track({ name: 's', steps: moves.squat() }, (f) => {
      hipMax = Math.max(hipMax, f.pose[PoseIndex.LEFT_HIP * 4 + 1]);
    });
    const standHip = 0.32 + 1.45 * SW;
    expect(hipMax).toBeGreaterThan(standHip + 1 * SW);
    let ankleMin = 1;
    track({ name: 'j', steps: moves.jumpUp() }, (f) => {
      ankleMin = Math.min(ankleMin, f.pose[PoseIndex.LEFT_ANKLE * 4 + 1]);
    });
    expect(ankleMin).toBeLessThan(0.32 + 3.69 * SW - 0.8 * SW);
  });

  it('drawBow pulls the draw hand back and closes it', () => {
    const script: Script = { name: 'd', steps: moves.drawBow('right') };
    let fistAtHold = 0;
    let startX = NaN;
    let holdX = NaN;
    track(script, (f, t) => {
      const x = f.pose[PoseIndex.RIGHT_WRIST * 4];
      if (t > 800 && Number.isNaN(startX)) startX = x;
      if (t > 2000 && t < 2100) {
        holdX = x;
        fistAtHold = f.hands[1].landmarks[8 * 3 + 1];
      }
    });
    expect(holdX).toBeGreaterThan(startX);
    expect(fistAtHold).toBeGreaterThan(0);
  });

  it('handsOnlyStart switches to hands-only mode', () => {
    const start = moves.handsOnlyStart();
    expect(start.handsOnly).toBe(1);
    expect(start.leftHandVisible).toBe(1);
  });
});

describe('demo scripts', () => {
  const required = [
    'idle',
    'wave',
    'fists',
    'bowl',
    'throw',
    'swing',
    'run',
    'hands',
    'lost',
    'all',
  ];

  it('registers every demo script', () => {
    for (const name of required) expect(listScripts()).toContain(name);
    expect(getScript('nope')).toBeNull();
  });

  it.each(required)('%s runs to completion with finite coordinates', (name) => {
    const script = getScript(name);
    expect(script).not.toBeNull();
    if (!script) return;
    expect(script.name).toBe(name);
    const frames = runToEnd(script);
    expect(frames.length).toBeGreaterThan(30);
  });

  it('hands is hands-only, lost drops the body for about 1.5 s, all loops back to its start', () => {
    const hands = getScript('hands');
    expect(hands?.start?.handsOnly).toBe(1);

    const lost = getScript('lost');
    expect(lost).not.toBeNull();
    if (lost) {
      let missing = 0;
      track(lost, (f) => {
        if (!f.hasPose) missing++;
      });
      expect((missing * 1000) / FPS).toBeGreaterThan(1400);
      expect((missing * 1000) / FPS).toBeLessThan(1700);
    }

    const all = getScript('all');
    expect(all?.loop).toBe(true);
    if (all) {
      const p = new ScriptPlayer(all);
      const a = defaultControls();
      const b = defaultControls();
      p.sample(0, a);
      p.sample(p.durationMs - 0.001, b);
      for (const k of Object.keys(a) as (keyof typeof a)[]) expect(b[k]).toBeCloseTo(a[k], 3);
    }
  });

  it('throw stays in body mode and fires an overarm throw after the run', () => {
    const script = getScript('throw');
    expect(script).not.toBeNull();
    if (!script) return;
    const player = new ScriptPlayer(script);
    const labels = new Set<string>();
    for (let t = 0; t < player.durationMs; t += 50) labels.add(player.labelAt(t));
    expect(labels).toContain('run');
    expect(labels).toContain('throw');
  });
});
