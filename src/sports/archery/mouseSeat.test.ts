// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../core/random';
import { makePlayers } from '../../core/multiplayer/players';
import type { Hud, SportContext, Turns } from '../../core/sport';
import { DebugInput } from '../../input/debug/DebugInput';
import { syntheticCalibration } from '../../input/testing/runScript';
import type { Calibration, Side } from '../../input/types';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { createFieldDayScene } from '../../render/style/scene';
import type { ArcherySport } from './index';
import { createArchery } from './index';

const FRAME_MS = 1000 / 60;

function hud(): Hud {
  return {
    setScore: vi.fn(),
    setSubScore: vi.fn(),
    setBanner: vi.fn(),
    setHint: vi.fn(),
    setMeter: vi.fn(),
    setTable: vi.fn(),
    flash: vi.fn(),
    setCursor: vi.fn(),
    clear: vi.fn(),
  };
}

/** Mouse play, two seats, with the shell's handover stood in for (it selects the seat's dominant hand). */
async function setup(hands: Side[]) {
  const cals: Calibration[] = hands.map((h) => ({ ...syntheticCalibration(), handedness: h }));
  const input = new DebugInput({
    target: new EventTarget(),
    viewport: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
  });
  await input.start({ pose: true, handCrops: true, fullFrameHands: false });
  input.selectHand(hands[0] ?? 'right'); // the host does this at game start
  let current = 0;
  let pending: { index: number; cb: () => void } | null = null;
  const turns: Turns = {
    count: hands.length,
    players: makePlayers([], hands.length),
    get current(): number {
      return current;
    },
    handOver: (index, cb) => {
      pending = { index, cb };
    },
    setStanding: () => undefined,
  };
  const random = mulberry32(1);
  const scene = createFieldDayScene();
  const avatar = new AvatarRig();
  scene.scene.add(avatar.root);
  const ctx = {
    stage: scene,
    avatar,
    input,
    hud: hud(),
    audio: { play: vi.fn(), setMuted: vi.fn() },
    tunables: { register: () => () => undefined },
    get calibration(): Calibration | null {
      return cals[current] ?? null;
    },
    best: null,
    random: () => random(),
    debug: false,
    short: true,
    get paused(): boolean {
      return pending !== null;
    },
    finish: vi.fn(),
    turns,
    finishMulti: vi.fn(),
    tutorial: false,
    coach: {
      show: vi.fn(),
      setFeedback: vi.fn(),
      confirm: vi.fn(),
      onSkip: vi.fn(),
      hide: vi.fn(),
    },
    finishTutorial: vi.fn(),
  } as unknown as SportContext;
  const sport = (await createArchery(ctx)) as ArcherySport;
  sport.start();
  let frame = 0;
  const step = (): void => {
    const now = 1000 + frame++ * FRAME_MS;
    input.update(now);
    if (pending === null) {
      sport.fixedUpdate(1 / 120, now);
      sport.fixedUpdate(1 / 120, now + FRAME_MS / 2);
    }
    sport.frame(1 / 60, now, 0);
  };
  const handOver = (): void => {
    const next = pending as { index: number; cb: () => void } | null;
    if (next === null) throw new Error('no handover');
    pending = null;
    current = next.index;
    input.selectHand(cals[next.index]?.handedness ?? 'right'); // the host, before onReady
    next.cb();
  };
  return { sport, input, step, handOver, isPending: () => pending !== null };
}

describe('archery mouse play across a handover', () => {
  it('keeps the mouse on the bow hand when both seats are right-handed, and the aim follows it', async () => {
    const g = await setup(['right', 'right']);
    expect(g.input.selectedHand).toBe('left');
    for (let i = 0; i < 30; i++) g.step();
    g.input.moveTo(0.4, 0.3);
    g.input.setButton(true);
    for (let i = 0; i < 400 && g.sport.draw < 0.97; i++) g.step();
    g.input.setButton(false);
    for (let i = 0; i < 1200 && !g.isPending(); i++) g.step();
    expect(g.isPending()).toBe(true);
    g.handOver();
    expect(g.input.selectedHand).toBe('left');
    for (let i = 0; i < 30; i++) g.step();
    const leftBefore = g.input.state.hands.left.x;
    g.input.moveTo(0.2, 0.3);
    g.step();
    g.step();
    expect(g.input.state.hands.left.x).toBeCloseTo(0.2, 2);
    expect(g.input.state.hands.left.x).not.toBeCloseTo(leftBefore, 2);
    // Drawing aims where the pointer is.
    g.input.setButton(true);
    for (let i = 0; i < 20; i++) g.step();
    const a = g.sport.reticle.x;
    g.input.moveTo(0.6, 0.3);
    for (let i = 0; i < 60; i++) g.step();
    expect(g.sport.reticle.x).not.toBeCloseTo(a, 1);
  }, 30000);
});
