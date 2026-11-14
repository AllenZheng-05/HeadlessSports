// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInputState } from '../../input/state';
import type { InputProvider } from '../../input/types';
import type { RendererHandle } from '../../render/renderer';
import type { LandmarkSource } from '../../tracking/types';
import type { Ui } from '../../ui/types';
import { parseFlags } from '../flags';
import { GameLoop } from '../loop';
import { MemoryScoreStore } from '../scores';
import type { RoundResult, Sport, SportContext, SportEntry, SportMeta } from '../sport';
import { PAUSE_AFTER_MS, RESUME_AFTER_MS, SportHost } from './SportHost';

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
};

const RESULT: RoundResult = { score: 3, headline: '3' };

function fakeUi(): Ui {
  const noop = vi.fn();
  return {
    hud: { setBanner: vi.fn(), clear: vi.fn() },
    audio: { play: noop, setMuted: noop },
    tunables: { register: () => noop },
    update: noop,
    setInput: noop,
    showLoading: noop,
    showPlaying: noop,
    showPause: vi.fn(),
    onQuit: noop,
    onCameraOff: noop,
    setCameraActive: noop,
  } as unknown as Ui;
}

function fakeRenderer(): RendererHandle {
  return { resize: vi.fn(), render: vi.fn(), drawCalls: () => 0 } as unknown as RendererHandle;
}

function fakeInput(source: unknown = null) {
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

function fakeSport(overrides: Partial<Sport> = {}) {
  const bot = { next: vi.fn() };
  const sport = {
    start: vi.fn(),
    fixedUpdate: vi.fn(),
    frame: vi.fn(),
    createBot: vi.fn(() => bot),
    dispose: vi.fn(),
    ...overrides,
  } satisfies Sport;
  return { sport, bot };
}

function setup(options: { source?: unknown; sport?: Sport; throwInFactory?: boolean } = {}) {
  const ui = fakeUi();
  const input = fakeInput(options.source ?? null);
  const loop = new GameLoop({ begin: vi.fn(), fixed: vi.fn(), frame: vi.fn() });
  const made = fakeSport();
  const sport = options.sport ?? made.sport;
  let ctx: SportContext | null = null;
  const entry: SportEntry = {
    meta,
    load: () =>
      Promise.resolve({
        default: (c: SportContext): Sport => {
          ctx = c;
          if (options.throwInFactory) throw new Error('boom');
          return sport;
        },
      }),
  };
  const host = new SportHost({
    renderer: fakeRenderer(),
    ui,
    input,
    scores: new MemoryScoreStore(),
    flags: parseFlags(''),
    loop,
  });
  return {
    host,
    ui,
    input,
    loop,
    sport,
    bot: made.bot,
    entry,
    getCtx: () => ctx as unknown as SportContext,
  };
}

async function started(host: SportHost): Promise<void> {
  await vi.waitFor(() => expect(host.phase).toBe('playing'));
}

afterEach(() => vi.restoreAllMocks());

describe('SportHost', () => {
  it('sets tracker needs from the meta, starts the sport and resolves play on finish', async () => {
    const { host, input, sport, entry, getCtx } = setup();
    const done = host.play(entry, null);
    await started(host);
    expect(input.setNeeds).toHaveBeenCalledWith(meta.requiredTrackers);
    expect(sport.start).toHaveBeenCalledOnce();
    host.fixed(1 / 120, 10);
    expect(sport.fixedUpdate).toHaveBeenCalledTimes(1);

    getCtx().finish(RESULT);
    getCtx().finish({ score: 99, headline: 'late' });
    await expect(done).resolves.toBe(RESULT);
    expect(host.phase).toBe('finished');
    expect(host.result).toBe(RESULT);

    host.fixed(1 / 120, 20);
    expect(sport.fixedUpdate).toHaveBeenCalledTimes(1);
    host.frame(0.016, 30, 0);
    expect(sport.frame).toHaveBeenCalledTimes(1); // still rendering behind the results

    host.release();
    expect(sport.dispose).toHaveBeenCalledOnce();
    expect(host.phase).toBe('idle');
  });

  it('quit resolves null and disposes', async () => {
    const { host, sport, entry } = setup();
    const done = host.play(entry, null);
    await started(host);
    host.quit();
    await expect(done).resolves.toBeNull();
    expect(sport.dispose).toHaveBeenCalledOnce();
    expect(host.phase).toBe('idle');
  });

  it('survives a throwing factory', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, ui, entry } = setup({ throwInFactory: true });
    await expect(host.play(entry, null)).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
    expect(ui.hud.setBanner).toHaveBeenCalledWith('That round broke. Back to the menu.', 2500);
    expect(host.phase).toBe('idle');
  });

  it('survives a throwing fixedUpdate', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = fakeSport({
      fixedUpdate: () => {
        throw new Error('bad step');
      },
    }).sport;
    const { host, entry } = setup({ sport: broken });
    const done = host.play(entry, null);
    await started(host);
    host.fixed(1 / 120, 0);
    await expect(done).resolves.toBeNull();
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    expect(host.phase).toBe('idle');
  });

  it('wires the bot to the synthetic source director', async () => {
    const enqueue = vi.fn();
    const setDirector = vi.fn();
    const source = { kind: 'synthetic', setDirector, queue: { enqueue } };
    const { host, sport, entry } = setup({ source });
    void host.play(entry, null);
    await started(host);
    const bot = (sport.createBot as ReturnType<typeof vi.fn>).mock.results[0]!.value as {
      next: ReturnType<typeof vi.fn>;
    };
    const director = setDirector.mock.calls[0]![0] as (q: unknown, t: number) => void;
    director({}, 5);
    expect(bot.next).toHaveBeenCalledWith(expect.any(Function), 5);
    const steps = [{ dur: 100 }];
    (bot.next.mock.calls[0]![0] as (s: unknown) => void)(steps);
    expect(enqueue).toHaveBeenCalledWith(steps);
    host.quit();
    expect(setDirector).toHaveBeenLastCalledWith(null);
  });

  it('pauses on a camera problem and resumes after it clears', async () => {
    const source = { kind: 'camera' } as unknown as LandmarkSource;
    const { host, ui, input, loop, entry } = setup({ source });
    void host.play(entry, null);
    await started(host);
    input.state.problem = 'lost';
    host.begin(1000, 0.016);
    host.begin(1000 + PAUSE_AFTER_MS - 1, 0.016);
    expect(host.phase).toBe('playing');
    host.begin(1000 + PAUSE_AFTER_MS + 1, 0.016);
    expect(host.phase).toBe('paused');
    expect(loop.paused).toBe(true);
    expect(ui.showPause).toHaveBeenCalledWith('lost');
    input.state.problem = 'none';
    host.begin(3000, 0);
    expect(host.phase).toBe('paused');
    host.begin(3000 + RESUME_AFTER_MS, 0);
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
  });

  it('never pauses for a debug input', async () => {
    const { host, input, entry } = setup();
    void host.play(entry, null);
    await started(host);
    input.state.problem = 'lost';
    host.begin(0, 0);
    host.begin(5000, 0);
    expect(host.phase).toBe('playing');
  });
});
