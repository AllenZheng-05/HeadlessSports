// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mesh, MeshToonMaterial } from 'three/webgpu';
import { createInputState } from '../../input/state';
import type { Calibration, GameEvent, InputProvider } from '../../input/types';
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
import { GO_CARD_MS, PAUSE_AFTER_MS, SportHost } from './SportHost';

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
    standings: {
      show: vi.fn(),
      set: vi.fn(),
      setCurrent: vi.fn(),
      setLeader: vi.fn(),
      hide: vi.fn(),
    },
    coach: NO_COACH,
    audio: { play: noop, setMuted: noop },
    tunables: { register: () => noop },
    update: noop,
    setInput: noop,
    showLoading: vi.fn(),
    showPlaying: vi.fn(),
    setHandoverHint: vi.fn(),
    showHandoverGo: vi.fn(),
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
    showHandoverGo: ReturnType<typeof vi.fn>;
    showPause: ReturnType<typeof vi.fn>;
    showPlaying: ReturnType<typeof vi.fn>;
    setHandoverHint: ReturnType<typeof vi.fn>;
    standings: Record<
      'show' | 'set' | 'setCurrent' | 'setLeader' | 'hide',
      ReturnType<typeof vi.fn>
    >;
    hud: { setBanner: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  };
}

function fakeInput(source: unknown) {
  /** Gesture events the provider has queued but not yet delivered. */
  const queue: GameEvent[] = [];
  const handlers: ((e: GameEvent) => void)[] = [];
  const input = {
    state: createInputState(),
    source,
    queue,
    delivered: [] as GameEvent[],
    start: vi.fn(() => Promise.resolve()),
    setNeeds: vi.fn(() => Promise.resolve()),
    setCalibration: vi.fn(),
    resetPlayer: vi.fn(() => {
      queue.length = 0;
    }),
    update: vi.fn(() => {
      for (const e of queue.splice(0)) {
        input.delivered.push(e);
        for (const h of handlers) h(e);
      }
    }),
    on: vi.fn(() => () => undefined),
    onAny: vi.fn((h: (e: GameEvent) => void) => {
      handlers.push(h);
      return () => undefined;
    }),
    stop: vi.fn(),
  };
  return input as typeof input & InputProvider;
}

interface SetupOptions {
  /** Runs inside the sport factory, before the round is playing. */
  factory?: (ctx: SportContext) => void;
  /** Runs inside `sport.start()`. */
  start?: (ctx: SportContext) => void;
  meta?: SportMeta;
}

function setup(source: unknown = null, options: SetupOptions = {}) {
  const ui = fakeUi();
  const input = fakeInput(source);
  const loop = new GameLoop({ begin: vi.fn(), fixed: vi.fn(), frame: vi.fn() });
  const sport: Sport = {
    start: vi.fn(() => options.start?.(ctx as unknown as SportContext)),
    fixedUpdate: vi.fn(),
    frame: vi.fn(),
    createBot: vi.fn(() => ({ next: vi.fn() })),
    dispose: vi.fn(),
  };
  let ctx: SportContext | null = null;
  const entry: SportEntry = {
    meta: options.meta ?? meta,
    load: () =>
      Promise.resolve({
        default: (c: SportContext): Sport => {
          ctx = c;
          options.factory?.(c);
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

/** Game time for the helper below; each handover gets a fresh stretch. */
let goClock = 100000;

/** Choose Ready, then let the "Go" on the card run its 800 ms of game time. */
async function clickAndGo(
  host: { begin(nowMs: number, dt: number): void },
  ui: { clickReady(): void; showHandoverGo: ReturnType<typeof vi.fn> },
): Promise<void> {
  const before = ui.showHandoverGo.mock.calls.length;
  ui.clickReady();
  await vi.waitFor(() => expect(ui.showHandoverGo.mock.calls.length).toBe(before + 1));
  goClock += 10000;
  host.begin(goClock, 0);
  host.begin(goClock + GO_CARD_MS, 0);
}

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

    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(ctx.turns.current).toBe(1);
    expect(ctx.calibration).toBe(CALS[1]);
    expect(ctx.calibration?.handedness).toBe('left');
    expect(input.setCalibration).toHaveBeenLastCalledWith(CALS[1]);
    expect(ui.standings.setCurrent).toHaveBeenLastCalledWith(1);
    // "Go" is on the card, not the hud banner.
    expect(ui.showHandoverGo).toHaveBeenCalledOnce();
    expect(ui.hud.setBanner).not.toHaveBeenCalledWith('Go', expect.any(Number));
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

  it('Ready turns the card to "Go" for 800 ms of game time, then the seat switches and the round resumes', async () => {
    const { host, ui, input, loop, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const ready = vi.fn();
    getCtx().turns.handOver(1, ready);
    ui.clickReady();
    await vi.waitFor(() => expect(ui.showHandoverGo).toHaveBeenCalledOnce());
    // Still paused under the card, nothing switched, the card not closed.
    expect(host.handingOver).toBe(true);
    expect(loop.paused).toBe(true);
    expect(ready).not.toHaveBeenCalled();
    expect(ui.hideHandover).not.toHaveBeenCalled();
    host.begin(5000, 0);
    host.begin(5000 + GO_CARD_MS - 50, 0);
    expect(ready).not.toHaveBeenCalled();
    expect(ui.hideHandover).not.toHaveBeenCalled();
    host.begin(5000 + GO_CARD_MS, 0);
    // Reset, calibration, then onReady, as before; the round runs again.
    expect(input.resetPlayer.mock.invocationCallOrder[1]).toBeLessThan(
      ready.mock.invocationCallOrder[0] as number,
    );
    expect(ui.hideHandover).toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
    expect(host.handingOver).toBe(false);
    expect(loop.paused).toBe(false);
    expect(ui.hud.setBanner).not.toHaveBeenCalledWith('Go', expect.anything());
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
    // The card turns to "Go" first; the seat switches when it closes.
    expect(synthetic.ui.showHandoverGo).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    synthetic.host.begin(1000 + handoverConfig.minShowMs + 100 + 1, 0);
    synthetic.host.begin(1000 + handoverConfig.minShowMs + 100 + 1 + GO_CARD_MS, 0);
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

  it('a handOver asked for in the factory runs once the round is playing, then resumes', async () => {
    const ready = vi.fn();
    const { host, ui, loop, entry, players, getCtx } = setup(null, {
      factory: (c) => c.turns.handOver(1, ready),
    });
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await vi.waitFor(() => expect(host.handingOver).toBe(true));
    // The card goes up after the playing screen replaced the loading one, and holds the loop.
    expect(ui.showHandover).toHaveBeenCalledOnce();
    expect(ui.showHandover.mock.invocationCallOrder[0]).toBeGreaterThan(
      ui.showPlaying.mock.invocationCallOrder[0] as number,
    );
    expect(host.phase).toBe('paused');
    expect(loop.paused).toBe(true);
    expect(getCtx().paused).toBe(true);
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(getCtx().turns.current).toBe(1);
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
  });

  it('a handOver asked for in start() shows the card and resumes the same way', async () => {
    const ready = vi.fn();
    const { host, ui, loop, entry, players, getCtx } = setup(null, {
      start: (c) => c.turns.handOver(2, ready),
    });
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await vi.waitFor(() => expect(host.handingOver).toBe(true));
    expect(ui.showHandover).toHaveBeenCalledOnce();
    expect(loop.paused).toBe(true);
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(getCtx().turns.current).toBe(2);
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
  });

  it('resumes after a handover even if the phase was changed under it (the loop is the truth)', async () => {
    const { host, ui, loop, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(1, vi.fn());
    expect(loop.paused).toBe(true);
    host.phase = 'playing';
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(host.handingOver).toBe(false));
    expect(loop.paused).toBe(false);
    expect(host.phase).toBe('playing');
  });

  it('the how-to cannot be opened over a handover card, and the round resumes when Ready is chosen', async () => {
    const ready = vi.fn();
    const { host, ui, loop, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(1, ready);
    ui.howTo(true);
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    // Had the open been honoured, the round would now be held by a how-to nobody can close.
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
  });

  it('a how-to that was already open keeps the round held after the handover, until it closes', async () => {
    const ready = vi.fn();
    const { host, ui, loop, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    ui.howTo(true);
    expect(host.phase).toBe('paused');
    getCtx().turns.handOver(1, ready);
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    // The seat switched, but the overlay is still up.
    expect(getCtx().turns.current).toBe(1);
    expect(host.phase).toBe('paused');
    expect(loop.paused).toBe(true);
    ui.howTo(false);
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
  });

  it('resets the input for the new person before onReady, and drops gestures queued before the switch', async () => {
    const seen: string[] = [];
    const { host, ui, input, entry, players, getCtx } = setup(null, {
      factory: (c) => {
        c.input.onAny((e) => seen.push(e.type));
      },
    });
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    // Seat 0 is calibrated from a clean slate.
    expect(input.resetPlayer).toHaveBeenCalledOnce();
    // What the sport hears once the seat has switched: nothing from the last player.
    const ready = vi.fn(() => {
      seen.length = 0;
      input.delivered.length = 0;
    });
    getCtx().turns.handOver(1, ready);
    // A half-detected throw from the person walking off is still queued when Ready is chosen.
    input.queue.push({ type: 'SwingPeak', t: 5, speed: 9, height: 1, plane: 0 });
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(input.resetPlayer).toHaveBeenCalledTimes(2);
    const reset = input.resetPlayer.mock.invocationCallOrder[1] as number;
    const calibrate = input.setCalibration.mock.invocationCallOrder.at(-1) as number;
    expect(reset).toBeLessThan(ready.mock.invocationCallOrder[0] as number);
    expect(calibrate).toBeLessThan(ready.mock.invocationCallOrder[0] as number);
    expect(input.setCalibration).toHaveBeenLastCalledWith(CALS[1]);
    input.update(100);
    expect(seen).toEqual([]);
    expect(input.delivered).toEqual([]);
  });

  it('mouse play: the selected hand follows each seat, and the single-player setting comes back', async () => {
    const { host, ui, input, entry, players, getCtx } = setup();
    let selected: 'left' | 'right' = 'left';
    const selectHand = vi.fn((side: 'left' | 'right') => {
      selected = side;
    });
    Object.assign(input, { mouseControl: true, selectHand });
    Object.defineProperty(input, 'selectedHand', { get: () => selected });
    const order: string[] = [];
    selectHand.mockImplementation((side) => {
      selected = side;
      order.push(`hand:${side}`);
    });
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    // Seat 0 is right-handed.
    expect(selected).toBe('right');
    const ready = vi.fn(() => order.push('ready'));
    getCtx().turns.handOver(1, ready);
    expect(selected).toBe('right');
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    // Seat 1 is left-handed, set before the sport hears onReady.
    expect(selected).toBe('left');
    expect(order.slice(-2)).toEqual(['hand:left', 'ready']);
    getCtx().turns.handOver(2, vi.fn());
    await clickAndGo(host, ui);
    await vi.waitFor(() => expect(selected).toBe('right'));
    host.quit();
    // The setting from before the game (left) is restored.
    expect(selected).toBe('left');
  });

  it('exposes every seat hand early through turns.handednessOf', async () => {
    const { host, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const turns = getCtx().turns;
    expect(turns.handednessOf?.(0)).toBe('right');
    expect(turns.handednessOf?.(1)).toBe('left');
    expect(turns.handednessOf?.(2)).toBe('right');
    // Reading it does not switch anything.
    expect(turns.current).toBe(0);
  });

  it('marks the leading seat on the strip and the card, ties included, never before anyone scores', async () => {
    const { host, ui, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const turns = getCtx().turns;
    for (let i = 0; i < 3; i++) turns.setStanding(i, 0, '0 pts');
    expect(ui.standings.setLeader).not.toHaveBeenCalled();
    turns.setStanding(0, 10, '10 pts');
    expect(ui.standings.setLeader).toHaveBeenLastCalledWith(0, true);
    turns.setStanding(1, 10, '10 pts');
    expect(ui.standings.setLeader).toHaveBeenLastCalledWith(1, true);
    turns.setStanding(2, 25, '25 pts');
    expect(ui.standings.setLeader).toHaveBeenCalledWith(0, false);
    expect(ui.standings.setLeader).toHaveBeenCalledWith(1, false);
    expect(ui.standings.setLeader).toHaveBeenLastCalledWith(2, true);
    turns.handOver(1, vi.fn());
    const info = ui.showHandover.mock.calls[0]![0] as { standings: { leading?: boolean }[] };
    expect(info.standings.map((e) => e.leading)).toEqual([false, false, true]);
  });

  it('respects a lower-is-better sport when marking the leader', async () => {
    const low: SportMeta = { ...meta, score: { ...meta.score, higherIsBetter: false } };
    const { host, ui, entry, players, getCtx } = setup(null, { meta: low });
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    const turns = getCtx().turns;
    for (let i = 0; i < 3; i++) turns.setStanding(i, 0, '-');
    // A seat still on its placeholder 0 has not scored: it must not lead.
    turns.setStanding(0, 30, '30 s');
    turns.setStanding(1, 20, '20 s');
    expect(ui.standings.setLeader).toHaveBeenLastCalledWith(1, true);
    expect(ui.standings.setLeader).toHaveBeenCalledWith(0, false);
    expect(ui.standings.setLeader).not.toHaveBeenCalledWith(2, true);
  });

  it('pads a short finishMulti with unranked seats and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, entry, players, getCtx } = setup();
    const done = host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().finishMulti([{ score: 4, headline: '4' }]);
    await expect(done).resolves.toBe(MULTI_DONE);
    expect(error).toHaveBeenCalled();
    expect(host.multiResults).toHaveLength(3);
    expect(host.multiResults?.[1]?.unranked).toBe(true);
    expect(host.multiResults?.[2]?.unranked).toBe(true);
  });

  it('forgets the game on teardown: seats and player count go back to one', async () => {
    const { host, entry, players, getCtx } = setup();
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(2, vi.fn());
    expect(host.playerCount).toBe(3);
    host.quit();
    expect(host.playerCount).toBe(1);
    expect(host.seat).toBe(0);
    expect(host.handingOver).toBe(false);
  });

  it('shows the swap-places hint for a camera card only once it is due', async () => {
    const { host, ui, input, entry, players, getCtx } = setup({ kind: 'camera' });
    void host.play(entry, null, { multiplayer: { players, calibrations: CALS } });
    await started(host);
    getCtx().turns.handOver(1, vi.fn());
    // The same person stays in frame the whole time.
    input.state.hasPose = true;
    input.state.tracking = true;
    input.state.problem = 'none';
    input.state.shoulderWidth = 0.18;
    host.begin(1000, 0);
    expect(ui.setHandoverHint).toHaveBeenLastCalledWith(false);
    host.begin(1000 + handoverConfig.hintAfterMs + 50, 0);
    expect(ui.setHandoverHint).toHaveBeenLastCalledWith(true);
    expect(host.handingOver).toBe(true);
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
