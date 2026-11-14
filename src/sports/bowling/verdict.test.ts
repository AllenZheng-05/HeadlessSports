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
async function bowl(speed: number, angle: number, hook: number) {
  const physics = await createRapierBowling({ ...bowlingConfig });
  const outcomes: RollOutcome[] = [];
  let contactAt = -1;
  let verdictAt = -1;
  let t = 0;
  const game = new BowlingGame(
    physics,
    { ...bowlingConfig },
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
  physics.launch(0, speed, angle, hook);
  while (verdictAt < 0 && t < 15) {
    game.fixedUpdate(DT, VIEW);
    t += DT;
  }
  physics.dispose();
  return { outcome: outcomes[0], afterContact: contactAt < 0 ? 0 : verdictAt - contactAt };
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
});
