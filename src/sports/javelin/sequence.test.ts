import { describe, expect, it } from 'vitest';
import { runScript } from '../../input/testing/runScript';
import type { GameEvent } from '../../input/types';
import { recognizerConfig } from '../../input/recognizers/config';
import type { Script } from '../../tracking/synthetic/script';
import { idle, overarmThrow, raiseArm, runInPlace } from '../../tracking/synthetic/scripts/moves';

/**
 * The exact sequence the javelin bot plays: raise a fist, run, throw. Run through the real
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
        ...raiseArm('right', { fist: true, holdMs: 500 }),
        ...idle(200),
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

describe('raise -> run -> throw through the real recognizers', () => {
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
        expect(count(events, 'ArmRaised')).toBeGreaterThanOrEqual(1);
        expect(maxCadence).toBeGreaterThan(3);
        expect(throws).toHaveLength(1);
        expect(real).toHaveLength(1);
        expect(real[0]!.type === 'ThrowReleased' && real[0]!.style).toBe('overarm');
        rows.push(
          `seed ${seed}: raised=${count(events, 'ArmRaised')} steps=${count(events, 'Step')} cad=${maxCadence.toFixed(2)} throws=${throws.length} ` +
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
