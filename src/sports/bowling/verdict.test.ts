import { describe, expect, it } from 'vitest';
import { bowlingConfig } from './config';
import { BowlingGame } from './game';
import type { PlayerView, RollOutcome } from './game';
import { createRapierBowling } from './physics';

const DT = 1 / 120;
const VIEW: PlayerView = {
  lateral: 0,
  hands: { left: { present: true, known: true }, right: { present: true, known: true } },
  arms: {
    left: { speed: 0, wristX: -0.12, wristY: -1.2 },
    right: { speed: 0, wristX: 0.12, wristY: -1.2 },
  },
};

/** Real physics, real rules: throw one ball and measure first contact to verdict. */
async function bowl(
  speed: number,
  angle: number,
  hook: number,
  x = 0,
  over: Partial<typeof bowlingConfig> = {},
) {
  const cfg = { ...bowlingConfig, ...over };
  const physics = await createRapierBowling(cfg);
  const outcomes: RollOutcome[] = [];
  let contactAt = -1;
  let verdictAt = -1;
  let t = 0;
  const game = new BowlingGame(
    physics,
    cfg,
    {
      contact: () => {
        if (contactAt < 0) contactAt = t;
      },
      rolled: (o) => {
        verdictAt = t;
        outcomes.push(o);
      },
    },
    { hand: 'right', frames: 10 },
  );
  game.start();
  game.onFistClosed('right');
  game.onThrow({ hand: 'right', speed: 6, lateral: 0.62, curvature: 0, style: 'underarm' });
  // Replace the mapped launch with the chosen one so the sweep covers the whole range.
  physics.launch(x, speed, angle, hook);
  while (verdictAt < 0 && t < 15) {
    game.fixedUpdate(DT, VIEW);
    t += DT;
  }
  // Keep simulating past the verdict: no standing pin may go down after the count was taken.
  const standingAtVerdict = physics.standingCount();
  const pinsBefore = pinStates(physics);
  let lateFalls = 0;
  for (let k = 0; k < 5 * 120; k++) physics.step(DT);
  if (physics.standingCount() < standingAtVerdict)
    lateFalls = standingAtVerdict - physics.standingCount();
  const late = lateFalls > 0 ? pinsBefore : '';
  // Play on through the sweep and reset: the next rack must show exactly what was counted.
  let present = -1;
  let standingNext = -1;
  if (over.settleTimeoutS !== undefined) {
    physics.rack(false);
    present = physics.pinPresent.filter(Boolean).length;
    standingNext = physics.standingCount();
  }
  physics.dispose();
  return {
    standingAtVerdict,
    present,
    standingNext,
    outcome: outcomes[0],
    afterContact: contactAt < 0 ? 0 : verdictAt - contactAt,
    lateFalls,
    late,
  };
}

function pinStates(physics: { standingCount(): number }): string {
  return String(physics.standingCount());
}

/** Small deterministic PRNG so the sweep is repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('verdict timing with real physics', () => {
  it('calls every roll within the cap and most well inside it', async () => {
    const times: number[] = [];
    const rows: string[] = [];
    for (const speed of [6, 8, 9.5]) {
      for (const angle of [-0.03, 0, 0.02, 0.05, 0.1]) {
        for (const hook of [0, 0.5]) {
          const r = await bowl(speed, angle, hook);
          if (r.afterContact > 0) times.push(r.afterContact);
          rows.push(
            `v=${speed} a=${angle} h=${hook}: ${r.outcome?.kind} ${r.outcome?.pins} ${r.afterContact.toFixed(2)}s`,
          );
          expect(r.afterContact).toBeLessThanOrEqual(bowlingConfig.settleTimeoutS + 0.05);
        }
      }
    }
    console.info(rows.join('\n'));
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] as number;
    console.info(`median after contact: ${median.toFixed(2)} s over ${times.length} contacts`);
    expect(median).toBeLessThan(2);
  }, 60000);

  it('never lets a pin fall after the count (400 varied throws)', async () => {
    const rand = rng(12345);
    const times: number[] = [];
    let late = 0;
    let lateThrows = 0;
    const bad: string[] = [];
    const throws = 400;
    for (let n = 0; n < throws; n++) {
      const speed = 4.5 + rand() * 5;
      const wide = rand() < 0.2;
      const angle = (rand() - 0.45) * (wide ? 0.16 : 0.05);
      const hook = rand() < 0.4 ? 0 : rand() * 0.7;
      const x = (rand() - 0.5) * (wide ? 0.8 : 0.4);
      const r = await bowl(speed, angle, hook, x);
      if (r.afterContact > 0) times.push(r.afterContact);
      if (r.lateFalls > 0) {
        late += r.lateFalls;
        lateThrows++;
        bad.push(
          `#${n} v=${speed.toFixed(2)} a=${angle.toFixed(3)} h=${hook.toFixed(2)} x=${x.toFixed(2)} counted ${r.outcome?.pins} late ${r.lateFalls} at ${r.afterContact.toFixed(2)}s`,
        );
      }
    }
    times.sort((a, b) => a - b);
    const q = (p: number): number =>
      times[Math.min(times.length - 1, Math.floor(times.length * p))] as number;
    console.info(
      `SWEEP throws=${throws} contacts=${times.length} lateThrows=${lateThrows} latePins=${late} median=${q(0.5).toFixed(2)} p95=${q(0.95).toFixed(2)} max=${q(1).toFixed(2)} over2.5=${times.filter((t) => t > 2.5).length} over4=${times.filter((t) => t > 4).length}`,
    );
    console.info(bad.join(String.fromCharCode(10)));

    expect(late).toBe(0);
    expect(lateThrows).toBe(0);
  }, 600000);

  it('shows exactly the pins it counted when the cap cuts a roll short', async () => {
    const rand = rng(777);
    let capped = 0;
    for (let n = 0; n < 40; n++) {
      const angle = (rand() - 0.45) * 0.05;
      const r = await bowl(4.5 + rand() * 5, angle, 0, (rand() - 0.5) * 0.4, {
        settleTimeoutS: 0.6,
      });
      if (r.afterContact <= 0) continue;
      if (r.afterContact >= 0.59) capped++;
      // Counted standing pins are the pins on the deck next roll, whether or not one toppled since.
      expect(r.present).toBe(r.standingAtVerdict);
      expect(r.standingNext).toBe(r.standingAtVerdict);
    }
    expect(capped).toBeGreaterThan(5);
  }, 120000);
});
