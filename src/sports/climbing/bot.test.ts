import { describe, expect, it } from 'vitest';
import { applyEase } from '../../tracking/synthetic/script';
import type { ScriptStep } from '../../tracking/synthetic/script';
import { createClimbBot } from './bot';
import { climbingConfig } from './config';
import { Layout, mulberry32 } from './layout';
import { createClimbState, createStepInput, heightOf, step } from './rules';

type Controls = Record<string, number>;

/**
 * Closed loop without a browser: the bot's script steps drive hand positions and fists exactly
 * like the synthetic player would (smooth interpolation, fist debounced by 100 ms), and the real
 * rules run at 120 Hz.
 */
function simulate(seed: number, seconds: number, round = 75): { grabs: number; height: number } {
  const cfg = { ...climbingConfig };
  const layout = new Layout(mulberry32(seed), cfg);
  const state = createClimbState(cfg, round);
  const input = createStepInput();
  const bot = createClimbBot(cfg, state, layout);
  const controls: Controls = {
    leftHandX: 0.35,
    leftHandY: 0.55,
    rightHandX: 0.65,
    rightHandY: 0.55,
    leftFist: 0,
    rightFist: 0,
  };
  const queue: ScriptStep[] = [];
  let cur: { step: ScriptStep; t: number; from: Controls } | null = null;
  const raw = { left: false, right: false };
  const since = { left: 0, right: 0 };
  const dt = 1 / 120;
  let now = 0;
  const enqueue = (s: ScriptStep[]): void => {
    queue.push(...s);
  };
  for (let i = 0; i < seconds * 120; i++) {
    now += dt * 1000;
    if (cur === null && queue.length === 0) bot.next(enqueue, now);
    if (cur === null && queue.length > 0) {
      const s = queue.shift()!;
      const from: Controls = {};
      for (const k of Object.keys(s.to ?? {})) from[k] = controls[k] ?? 0;
      cur = { step: s, t: 0, from };
    }
    if (cur !== null) {
      cur.t += dt * 1000;
      const p = Math.min(1, cur.t / cur.step.dur);
      const e = applyEase(cur.step.ease ?? 'smooth', p);
      for (const [k, v] of Object.entries(cur.step.to ?? {})) {
        if (k in controls) controls[k] = cur.from[k]! + (v - cur.from[k]!) * e;
      }
      if (p >= 1) cur = null;
    }
    for (const side of ['left', 'right'] as const) {
      const fist = controls[`${side}Fist`]! > 0.5;
      if (fist !== raw[side]) {
        raw[side] = fist;
        since[side] = now;
      }
      if (now - since[side] >= 100) input[side].closed = raw[side];
      input[side].x = controls[`${side}HandX`]!;
      input[side].y = controls[`${side}HandY`]!;
    }
    layout.ensure(state.y + 6);
    step(state, cfg, layout, input, dt);
  }
  return { grabs: state.grabs, height: state.best };
}

describe('synthetic climber', () => {
  it('climbs more than 15 m in 30 simulated seconds', () => {
    const r = simulate(1, 30);
    expect(r.height).toBeGreaterThan(15);
    expect(r.grabs).toBeGreaterThan(15);
  });

  it('climbs on several seeds without falling in a short round', () => {
    for (const seed of [2, 3, 4, 5]) {
      const cfg = { ...climbingConfig };
      const r = simulate(seed, cfg.shortRoundSeconds);
      expect(r.height).toBeGreaterThan(6);
    }
  });

  it('sanity: heightOf matches the start', () => {
    const cfg = { ...climbingConfig };
    expect(heightOf(createClimbState(cfg, 75), cfg)).toBe(0);
  });
});
