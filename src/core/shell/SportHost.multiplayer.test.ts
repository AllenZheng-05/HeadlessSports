// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mesh, MeshToonMaterial } from 'three/webgpu';
import { createInputState } from '../../input/state';
import type { Calibration, InputProvider } from '../../input/types';
import type { RendererHandle } from '../../render/renderer';
import type { Ui } from '../../ui/types';
import { parseFlags } from '../flags';
import { GameLoop } from '../loop';
import { makePlayers, PLAYER_COLORS } from '../multiplayer/players';
import { MULTI_DONE } from '../multiplayer/result';
import { handoverConfig } from '../multiplayer/readiness';
import { MemoryScoreStore } from '../scores';
import type { RoundResult, Sport, SportContext, SportEntry, SportMeta } from '../sport';
import { NO_COACH } from '../tutorial/noCoach';
import { PAUSE_AFTER_MS, SportHost } from './SportHost';

const meta: SportMeta = {
  id: 'fake',
  title: 'Fake',
  tagline: 'x',
  accent: 0xff0000,
  requiredTrackers: { pose: true, handCrops: true, fullFrameHands: false },
  stance: 'upper-body',
  seatedOk: true,
  needsSpace: false,
  score: { label: 'Score', unit: '', decimals: 0, higherIsBetter: true },
  howTo: [],
  debugKeys: [],
  multiplayer: { turnLabel: 'turn', maxPlayers: 4 },
};

const cal = (handedness: 'left' | 'right', centreX: number): Calibration => ({
  centreX,
  centreY: 0.4,
  hipY: 0.7,
  shoulderWidth: 0.18,
  armLength: 1.5,
  handedness,
  seated: false,
});
const CALS = [cal('right', 0.4), cal('left', 0.5), cal('right', 0.6)];

function fakeUi() {
  const noop = vi.fn();
  let resolveCard: (choice: 'ready' | 'cancel') => void = () => undefined;
  const ui = {
    hud: { setBanner: vi.fn(), clear: vi.fn() },
    standings: { show: vi.fn(), set: vi.fn(), setCurrent: vi.fn(), hide: vi.fn() },
    coach: NO_COACH,
    audio: { play: noop, setMuted: noop },
    tunables: { register: () => noop },
    update: noop,
    setInput: noop,
    showLoading: vi.fn(),
    showPlaying: noop,
    showPause: vi.fn(),
    showHandover: vi.fn(
      () =>
        new Promise<'ready' | 'cancel'>((resolve) => {
          resolveCard = resolve;
        }),
    ),
    hideHandover: vi.fn(),
    onQuit: noop,
    onCameraOff: noop,
    onCameraOn: noop,
    onHowToPlay: (handler: (open: boolean) => void) => {
      (ui as unknown as { howTo: typeof handler }).howTo = handler;
    },
    onTutorialEnd: noop,
    setCameraOnAvailable: noop,
    setCameraActive: noop,
    clickReady: () => resolveCard('ready'),
  };
  return ui as unknown as Ui & {
    howTo: (open: boolean) => void;
    clickReady: () => void;
    showHandover: ReturnType<typeof vi.fn>;
    hideHandover: ReturnType<typeof vi.fn>;
    showPause: ReturnType<typeof vi.fn>;
    standings: Record<'show' | 'set' | 'setCurrent' | 'hide', ReturnType<typeof vi.fn>>;
    hud: { setBanner: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  };
}

function fakeInput(source: unknown) {
  const input = {
    state: createInputState(),
    source,
    start: vi.fn(() => Promise.resolve()),
    setNeeds: vi.fn(() => Promise.resolve()),
    setCalibration: vi.fn(),
    update: vi.fn(),
    on: vi.fn(() => () => undefined),
    onAny: vi.fn(() => () => undefined),
    stop: vi.fn(),
  };
  return input as typeof input & InputProvider;
}

function setup(source: unknown = null) {
  const ui = fakeUi();
  const input = fakeInput(source);
  const loop = new GameLoop({ begin: vi.fn(), fixed: vi.fn(), frame: vi.fn() });
  const sport: Sport = {
    start: vi.fn(),
    fixedUpdate: vi.fn(),
    frame: vi.fn(),
    createBot: vi.fn(() => ({ next: vi.fn() })),
    dispose: vi.fn(),
  };
  let ctx: SportContext | null = null;
  const entry: SportEntry = {
    meta,
    load: () =>
      Promise.resolve({
        default: (c: SportContext): Sport => {
          ctx = c;
          return sport;
        },
      }),
  };
  const scores = new MemoryScoreStore();
  const host = new SportHost({
    renderer: { resize: vi.fn(), render: vi.fn(), drawCalls: () => 0 } as unknown as RendererHandle,
    ui,
    input,
    scores,
    flags: parseFlags(''),
    loop,
  });
  const players = makePlayers(['Mia', 'Sam', 'Zoe'], 3);
  return {
    host,
    ui,
    input,
    loop,
    sport,
    entry,
    scores,
    players,
    getCtx: () => ctx as unknown as SportContext,
  };
}

async function started(host: SportHost): Promise<void> {
  await vi.waitFor(() => expect(host.phase).toBe('playing'));
}

afterEach(() => vi.restoreAllMocks());

describe('SportHost pass-and-play', () => {
  it('gives one player a single-seat Turns and calls a same-seat handOver on the next frame', async () => {
    const { host, ui, entry, getCtx } = setup();
    void host.play(entry, CALS[0] as Calibration);
    await started(host);
    const ctx = getCtx();
    expect(ctx.turns.count).toBe(1);
    expect(ctx.turns.current).toBe(0);
    expect(ctx.calibration).toBe(CALS[0]);
    const ready = vi.fn();
    ctx.turns.handOver(0, ready);
    expect(ready).not.toHaveBeenCalled();
    host.begin(10, 0);
    expect(ready).toHaveBeenCalledOnce();
    expect(ui.showHandover).not.toHaveBeenCalled();
    ctx.turns.setStanding(0, 5, '5 pts');
    expect(ui.standings.set).not.toHaveBeenCalled();
    expect(ui.standings.show).not.toHaveBeenCalled();
  });

  it('starts a multiplayer round on seat 0 with its calibration, colour and standings', async () => {
    const { host, ui, input, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const ctx = getCtx();
    expect(ctx.turns.count).toBe(3);
    expect(ctx.turns.players).toBe(players);
    expect(ctx.calibration).toBe(CALS[0]);
    expect(ctx.best).toBeNull();
    expect(input.setCalibration).toHaveBeenLastCalledWith(CALS[0]);
    expect(ui.standings.show).toHaveBeenCalledWith(players);
    expect(ui.standings.setCurrent).toHaveBeenLastCalledWith(0);
    const mitt = (ctx.avatar.mitts.left.children[0] as Mesh).material as MeshToonMaterial;
    expect(mitt.color.getHex()).toBe(PLAYER_COLORS[0]);
  });

  it('handOver pauses the round, shows the card, then switches calibration, colour and seat', async () => {
    const { host, ui, input, loop, sport, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const ctx = getCtx();
    ctx.turns.setStanding(0, 7, '7 pts');
    const ready = vi.fn();
    ctx.turns.handOver(1, ready);

    // Paused: gesture events are ignored, no simulation, the loop holds still.
    expect(ctx.paused).toBe(true);
    expect(host.phase).toBe('paused');
    expect(host.handingOver).toBe(true);
    expect(loop.paused).toBe(true);
    host.fixed(1 / 120, 10);
    expect(sport.fixedUpdate).not.toHaveBeenCalled();
    const info = ui.showHandover.mock.calls[0]![0] as {
      player: { name: string };
      mode: string;
      standings: { text: string }[];
    };
    expect(info.player.name).toBe('Sam');
    expect(info.mode).toBe('up');
    expect(info.standings.map((s) => s.text)).toEqual(['7 pts', '', '']);
    // Nothing has switched yet.
    expect(ctx.turns.current).toBe(0);
    expect(ctx.calibration).toBe(CALS[0]);

    ui.clickReady();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(ctx.turns.current).toBe(1);
    expect(ctx.calibration).toBe(CALS[1]);
    expect(ctx.calibration?.handedness).toBe('left');
    expect(input.setCalibration).toHaveBeenLastCalledWith(CALS[1]);
    expect(ui.standings.setCurrent).toHaveBeenLastCalledWith(1);
    expect(ui.hud.setBanner).toHaveBeenCalledWith('Go', expect.any(Number));
    expect(ui.hideHandover).toHaveBeenCalled();
    const mitt = (ctx.avatar.mitts.right.children[0] as Mesh).material as MeshToonMaterial;
    expect(mitt.color.getHex()).toBe(PLAYER_COLORS[1]);
    // The callback runs after the round resumed.
    expect(ctx.paused).toBe(false);
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
    host.fixed(1 / 120, 20);
    expect(sport.fixedUpdate).toHaveBeenCalledOnce();
  });

  it('handOver to the seat that is up shows no card and calls back on the next frame', async () => {
    const { host, ui, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const ready = vi.fn();
    getCtx().turns.handOver(0, ready);
    expect(ui.showHandover).not.toHaveBeenCalled();
    expect(getCtx().paused).toBe(false);
    host.begin(10, 0);
    expect(ready).toHaveBeenCalledOnce();
    host.begin(20, 0);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('keeps the frame-problem pause out of a handover (the previous player is meant to leave)', async () => {
    const source = { kind: 'camera' };
    const { host, ui, input, entry, players, getCtx } = setup(source);
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(1, vi.fn());
    input.state.problem = 'lost';
    host.begin(1000, 0);
    host.begin(1000 + PAUSE_AFTER_MS + 100, 0);
    expect(ui.showPause).not.toHaveBeenCalledWith('lost');
    expect(host.handingOver).toBe(true);
  });

  it('closing the how-to overlay does not resume a round that is waiting on a handover', async () => {
    const { host, ui, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(1, vi.fn());
    ui.howTo(true);
    ui.howTo(false);
    expect(host.phase).toBe('paused');
    expect(getCtx().paused).toBe(true);
  });

  it('a synthetic source moves on by itself after the minimum card time; the mouse never does', async () => {
    const synthetic = setup({ kind: 'synthetic', setDirector: vi.fn() });
    void synthetic.host.play(synthetic.entry, null, {
      multiplayer: { players: synthetic.players, calibrations: CALS },
    });
    await started(synthetic.host);
    const ready = vi.fn();
    synthetic.getCtx().turns.handOver(2, ready);
    synthetic.host.begin(1000, 0);
    synthetic.host.begin(1000 + handoverConfig.minShowMs - 100, 0);
    expect(ready).not.toHaveBeenCalled();
    synthetic.host.begin(1000 + handoverConfig.minShowMs + 100, 0);
    expect(ready).toHaveBeenCalledOnce();
    expect(synthetic.getCtx().turns.current).toBe(2);

    const mouse = setup(null);
    void mouse.host.play(mouse.entry, null, {
      multiplayer: { players: mouse.players, calibrations: CALS },
    });
    await started(mouse.host);
    const mouseReady = vi.fn();
    mouse.getCtx().turns.handOver(2, mouseReady);
    mouse.host.begin(1000, 0);
    mouse.host.begin(60000, 0);
    expect(mouseReady).not.toHaveBeenCalled();
    expect(mouse.host.handingOver).toBe(true);
  });

  it('finishMulti resolves play with MULTI_DONE and keeps the per-seat results', async () => {
    const { host, entry, players, getCtx } = setup();
    const done = host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const results: RoundResult[] = [
      { score: 5, headline: '5' },
      { score: 9, headline: '9' },
      { score: 5, headline: '5' },
    ];
    getCtx().finishMulti(results);
    await expect(done).resolves.toBe(MULTI_DONE);
    expect(host.multiResults).toBe(results);
    expect(host.phase).toBe('finished');
  });

  it('a stray finish() in a multiplayer game is logged and shows that one result for the current seat', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, entry, players, getCtx } = setup();
    const done = host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const result: RoundResult = { score: 12, headline: '12' };
    getCtx().finish(result);
    await expect(done).resolves.toBe(MULTI_DONE);
    expect(error).toHaveBeenCalled();
    expect(host.multiResults?.[0]).toBe(result);
    expect(host.multiResults).toHaveLength(3);
  });

  it('quitting during a handover takes the card down and saves nothing', async () => {
    const { host, ui, entry, scores, players, getCtx } = setup();
    const done = host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(1, vi.fn());
    host.quit();
    await expect(done).resolves.toBeNull();
    expect(ui.hideHandover).toHaveBeenCalled();
    expect(host.handingOver).toBe(false);
    expect(await scores.best('fake', true)).toBeNull();
  });

  it('a tutorial is never multiplayer, and a sport without meta.multiplayer ignores the setup', async () => {
    const t = setup();
    void t.host.play({ ...t.entry, meta: { ...meta, hasTutorial: true } }, CALS[0] as Calibration, {
      tutorial: true,
      multiplayer: { players: t.players, calibrations: CALS },
    });
    await started(t.host);
    expect(t.getCtx().turns.count).toBe(1);

    const s = setup();
    const { multiplayer: _removed, ...plain } = meta;
    void s.host.play({ ...s.entry, meta: plain }, CALS[0] as Calibration, {
      multiplayer: { players: s.players, calibrations: CALS },
    });
    await started(s.host);
    expect(s.getCtx().turns.count).toBe(1);
  });
});
