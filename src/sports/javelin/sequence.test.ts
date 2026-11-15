import { describe, expect, it } from 'vitest';
import { runScript } from '../../input/testing/runScript';
import type { GameEvent } from '../../input/types';
import { recognizerConfig } from '../../input/recognizers/config';
import type { Script } from '../../tracking/synthetic/script';
import { idle, jogInPlace, overarmThrow, runInPlace } from '../../tracking/synthetic/scripts/moves';

/**
 * The exact sequence the javelin bot plays: run on the spot, then throw (no fist, no raise). Run through the real
 * recognizers (synthetic source -> TrackedInput) on seeds 1 to 5.
 */
function play(seed: number, pauseMs: number, overrideBodySpeed?: number) {
  const saved = recognizerConfig.throw.maxBodySpeed;
  if (overrideBodySpeed !== undefined) recognizerConfig.throw.maxBodySpeed = overrideBodySpeed;
  try {
    const script: Script = {
      name: 'javelin-seq',
      steps: [
        ...idle(600),
        ...runInPlace({ steps: 14, stepsPerSecond: 4 }),
        ...(pauseMs > 0 ? idle(pauseMs) : []),
        ...overarmThrow('right', { power: 0.9, loftDeg: 35 }),
        ...idle(400),
      ],
    };
    const cad: number[] = [];
    const run = runScript(script, {
      seed,
      onFrame: (s) => {
        if (s.cadence.stepsPerSecond > 0) cad.push(s.cadence.stepsPerSecond);
      },
    });
    return { events: run.events, maxCadence: Math.max(0, ...cad) };
  } finally {
    recognizerConfig.throw.maxBodySpeed = saved;
  }
}

const count = (events: GameEvent[], type: GameEvent['type']): number =>
  events.filter((e) => e.type === type).length;

describe('run -> throw through the real recognizers', () => {
  for (const mode of [
    { name: 'default config, no pause', pause: 0, override: undefined },
    { name: 'default config, 450 ms pause', pause: 450, override: undefined },
    { name: 'maxBodySpeed 8, no pause', pause: 0, override: 8 },
  ]) {
    it(mode.name, () => {
      const rows: string[] = [];
      for (let seed = 1; seed <= 5; seed++) {
        const { events, maxCadence } = play(seed, mode.pause, mode.override);
        const throws = events.filter((e) => e.type === 'ThrowReleased');
        const real = throws.filter((e) => e.type === 'ThrowReleased' && e.speed >= 2.5);
        expect(maxCadence).toBeGreaterThan(3);
        expect(throws).toHaveLength(1);
        expect(real).toHaveLength(1);
        expect(real[0]!.type === 'ThrowReleased' && real[0]!.style).toBe('overarm');
        rows.push(
          `seed ${seed}: steps=${count(events, 'Step')} cad=${maxCadence.toFixed(2)} throws=${throws.length} ` +
            real
              .map((e) =>
                e.type === 'ThrowReleased'
                  ? `[t=${e.t.toFixed(0)} v=${e.speed.toFixed(1)} ${e.style}]`
                  : '',
              )
              .join(''),
        );
      }
      console.info([mode.name, ...rows].join(String.fromCharCode(10)));
      expect(rows.length).toBe(5);
    });
  }
});

describe('a whole-body jog -> throw through the real recognizers', () => {
  it('the pump never makes an overarm throw; the throw makes exactly one; cadence stops after the jog', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const script: Script = {
        name: 'javelin-jog-seq',
        steps: [
          ...idle(600),
          ...jogInPlace({
            steps: 12,
            stepsPerSecond: 4,
            kneeLift: 0.3,
            armPump: 0.4,
            settle: false,
          }),
          ...overarmThrow('right', { power: 0.9, loftDeg: 100 }),
          ...idle(400),
        ],
      };
      let peak = 0;
      const run = runScript(script, {
        seed,
        needs: { pose: true, handCrops: false, fullFrameHands: false },
        onFrame: (s) => {
          peak = Math.max(peak, s.cadence.stepsPerSecond);
        },
      });
      const overarm = run.events.filter((e) => e.type === 'ThrowReleased' && e.style === 'overarm');
      expect(overarm).toHaveLength(1);
      expect(peak).toBeGreaterThan(3.5);
      expect(peak).toBeLessThan(4.6);
      // Steps come from the jog (it ends at 600 + 250 + 3000 ms), not from the throw after it: at
      // most the arm's first move into the throw can read as one more step.
      const late = run.events.filter((e) => e.type === 'Step' && e.t > 600 + 250 + 3000 + 50);
      expect(late.length).toBeLessThanOrEqual(1);
    }
  });
});
