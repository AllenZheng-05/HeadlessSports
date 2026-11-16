// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { createInputState } from '../../input/state';
import type { InputProvider } from '../../input/types';
import type { RendererHandle } from '../../render/renderer';
import type { LandmarkSource } from '../../tracking/types';
import type { Ui } from '../../ui/types';
import { parseFlags } from '../flags';
import { GameLoop } from '../loop';
import { MemoryScoreStore } from '../scores';
import type { RoundResult, Sport, SportContext, SportEntry, SportMeta } from '../sport';
import { NO_COACH } from '../tutorial/noCoach';
import { TUTORIAL_DONE } from '../tutorial/result';
import { PAUSE_AFTER_MS, RESUME_AFTER_MS, SportHost, withHandCrops } from './SportHost';

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

type FakeUi = Ui & { howTo: (open: boolean) => void; endTutorial: () => void };

function fakeUi(): FakeUi {
  const noop = vi.fn();
  let howTo: (open: boolean) => void = () => undefined;
  let tutorialEnd: () => void = () => undefined;
  return {
    howTo: (open: boolean) => howTo(open),
    onHowToPlay: (handler: (open: boolean) => void) => {
      howTo = handler;
    },
    endTutorial: () => tutorialEnd(),
    onTutorialEnd: (handler: () => void) => {
      tutorialEnd = handler;
    },
    coach: {
      show: vi.fn(),
      setFeedback: vi.fn(),
      confirm: vi.fn(),
      onSkip: vi.fn(() => () => undefined),
      hide: vi.fn(),
    },
    hud: { setBanner: vi.fn(), clear: vi.fn() },
    audio: { play: noop, setMuted: noop },
    tunables: { register: () => noop },
    update: noop,
    setInput: noop,
    showLoading: vi.fn(),
    showPlaying: noop,
    showPause: vi.fn(),
    onQuit: noop,
    onCameraOff: noop,
    onCameraOn: noop,
    setCameraOnAvailable: noop,
    setCameraActive: noop,
  } as unknown as FakeUi;
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

function setup(
  options: {
    source?: unknown;
    sport?: Sport;
    throwInFactory?: boolean;
    meta?: SportMeta;
  } = {},
) {
  const ui = fakeUi();
  const input = fakeInput(options.source ?? null);
  const loop = new GameLoop({ begin: vi.fn(), fixed: vi.fn(), frame: vi.fn() });
  const made = fakeSport();
  const sport = options.sport ?? made.sport;
  let ctx: SportContext | null = null;
  const entry: SportEntry = {
    meta: options.meta ?? meta,
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

/** Adds a mesh to the stage and returns what must be released when the round is over. */
function probeStage(ctx: SportContext) {
  const geometry = new BoxGeometry();
  const material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material);
  ctx.stage.scene.add(mesh);
  const geoDisposed = vi.fn();
  const objDisposed = vi.fn();
  geometry.addEventListener('dispose', geoDisposed);
  mesh.addEventListener('dispose', objDisposed);
  const avatarMesh = ctx.avatar.root.getObjectByName('torso-mesh') as Mesh;
  const avatarDisposed = vi.fn();
  avatarMesh.addEventListener('dispose', avatarDisposed);
  return { geoDisposed, objDisposed, avatarDisposed };
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

  it('releases the whole stage when a round ends and is released', async () => {
    const { host, entry, getCtx } = setup();
    const done = host.play(entry, null);
    await started(host);
    const probe = probeStage(getCtx());
    getCtx().finish(RESULT);
    await done;
    expect(probe.objDisposed).not.toHaveBeenCalled(); // still shown behind the results
    host.release();
    expect(probe.geoDisposed).toHaveBeenCalled();
    expect(probe.objDisposed).toHaveBeenCalled();
    expect(probe.avatarDisposed).toHaveBeenCalled();
  });

  it('releases the whole stage when a round is quit', async () => {
    const { host, entry, getCtx } = setup();
    const done = host.play(entry, null);
    await started(host);
    const probe = probeStage(getCtx());
    host.quit();
    await done;
    expect(probe.geoDisposed).toHaveBeenCalled();
    expect(probe.objDisposed).toHaveBeenCalled();
    expect(probe.avatarDisposed).toHaveBeenCalled();
  });

  it('releases the whole stage when the sport factory throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, entry, getCtx, input } = setup({ throwInFactory: true });
    // The factory throws after the stage exists; watch the avatar from inside setNeeds.
    let probe: ReturnType<typeof probeStage> | null = null;
    input.setNeeds.mockImplementation(() => Promise.resolve());
    const origLoad = entry.load;
    entry.load = async () => {
      const mod = await origLoad();
      return {
        default: (c: SportContext): Sport | Promise<Sport> => {
          probe = probeStage(c);
          return mod.default(c);
        },
      };
    };
    await host.play(entry, null);
    expect(getCtx()).toBeDefined();
    expect(probe).not.toBeNull();
    const p = probe as unknown as ReturnType<typeof probeStage>;
    expect(p.geoDisposed).toHaveBeenCalled();
    expect(p.objDisposed).toHaveBeenCalled();
    expect(p.avatarDisposed).toHaveBeenCalled();
  });

  it('survives a throwing factory', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, ui, entry } = setup({ throwInFactory: true });
    await expect(host.play(entry, null)).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
    // The shell reports the failure on the menu; no HUD banner is left behind.
    expect(host.lastRoundFailed).toBe(true);
    expect(ui.hud.setBanner).not.toHaveBeenCalled();
    expect(ui.hud.clear).toHaveBeenCalled();
    expect(host.phase).toBe('idle');
  });

  it('flags a throwing sport method, and resets the flag on the next play', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = fakeSport({
      frame: () => {
        throw new Error('bad frame');
      },
    }).sport;
    const { host, entry, ui } = setup({ sport: broken });
    const done = host.play(entry, null);
    await started(host);
    host.frame(0.016, 0, 0);
    await expect(done).resolves.toBeNull();
    expect(host.lastRoundFailed).toBe(true);
    expect(ui.hud.setBanner).not.toHaveBeenCalled();
    const second = host.play(entry, null);
    expect(host.lastRoundFailed).toBe(false);
    host.quit();
    await second;
    expect(host.lastRoundFailed).toBe(false);
  });

  it('a plain quit is not a failure', async () => {
    const { host, entry } = setup();
    const done = host.play(entry, null);
    await started(host);
    host.quit();
    await done;
    expect(host.lastRoundFailed).toBe(false);
  });

  it('quit after the round finished tears the finished sport down', async () => {
    const { host, sport, entry, getCtx } = setup();
    const done = host.play(entry, null);
    await started(host);
    getCtx().finish(RESULT);
    await done;
    expect(host.phase).toBe('finished');
    host.quit();
    expect(sport.dispose).toHaveBeenCalledOnce();
    expect(host.phase).toBe('idle');
    expect(host.sport).toBeNull();
  });

  it('shows a cancellable loading screen and quit abandons a load that never resolves', async () => {
    const { host, ui, entry } = setup();
    entry.load = () => new Promise(() => undefined);
    const done = host.play(entry, null);
    expect(host.phase).toBe('loading');
    const showLoading = ui.showLoading as ReturnType<typeof vi.fn>;
    const onCancel = showLoading.mock.calls[0]![2] as () => void;
    expect(typeof onCancel).toBe('function');
    onCancel();
    await expect(done).resolves.toBeNull();
    expect(host.phase).toBe('idle');
    expect(host.lastRoundFailed).toBe(false);
  });

  it('disposes a sport whose factory resolves after the player quit the load', async () => {
    const { host, entry, sport } = setup();
    let release: (s: Sport) => void = () => undefined;
    const late = new Promise<Sport>((resolve) => {
      release = resolve;
    });
    const factoryEntered = vi.fn();
    entry.load = () =>
      Promise.resolve({
        default: () => {
          factoryEntered();
          return late;
        },
      });
    const done = host.play(entry, null);
    await vi.waitFor(() => expect(factoryEntered).toHaveBeenCalled());
    host.quit();
    await expect(done).resolves.toBeNull();
    expect(sport.dispose).not.toHaveBeenCalled();
    release(sport);
    await vi.waitFor(() => expect(sport.dispose).toHaveBeenCalledOnce());
    expect(sport.start).not.toHaveBeenCalled();
    expect(host.phase).toBe('idle');
    expect(host.sport).toBeNull();
  });

  it('never calls the factory when the module loads after the player quit', async () => {
    const { host, entry, getCtx } = setup();
    let loaded: (m: { default: () => Sport }) => void = () => undefined;
    const factory = vi.fn();
    entry.load = () =>
      new Promise((resolve) => {
        loaded = resolve as typeof loaded;
      });
    const done = host.play(entry, null);
    host.quit();
    await done;
    loaded({ default: factory as unknown as () => Sport });
    await Promise.resolve();
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
    expect(getCtx()).toBeNull();
    expect(host.phase).toBe('idle');
  });

  it('ctx.paused follows the pause phase', async () => {
    const source = { kind: 'camera' } as unknown as LandmarkSource;
    const { host, input, entry, getCtx } = setup({ source });
    void host.play(entry, null);
    await started(host);
    expect(getCtx().paused).toBe(false);
    input.state.problem = 'lost';
    host.begin(1000, 0.016);
    host.begin(1000 + PAUSE_AFTER_MS + 1, 0.016);
    expect(host.phase).toBe('paused');
    expect(getCtx().paused).toBe(true);
    input.state.problem = 'none';
    host.begin(3000, 0);
    host.begin(3000 + RESUME_AFTER_MS, 0);
    expect(host.phase).toBe('playing');
    expect(getCtx().paused).toBe(false);
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
    const director = setDirector.mock.calls[0]![0] as (q: unknown, rel: number, t: number) => void;
    director({}, 5, 12345);
    expect(bot.next).toHaveBeenCalledWith(expect.any(Function), 12345);
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

  it('pauses while the how-to overlay is open and resumes when it closes', async () => {
    const { host, ui, loop, entry, getCtx } = setup();
    void host.play(entry, null);
    await started(host);
    ui.howTo(true);
    expect(host.phase).toBe('paused');
    expect(loop.paused).toBe(true);
    expect(getCtx().paused).toBe(true);
    host.begin(1000, 0);
    host.begin(5000, 0);
    expect(host.phase).toBe('paused');
    ui.howTo(false);
    expect(host.phase).toBe('playing');
    expect(loop.paused).toBe(false);
    expect(getCtx().paused).toBe(false);
  });

  it('keeps a camera pause going when the overlay closes during a camera problem', async () => {
    const source = { kind: 'camera' } as unknown as LandmarkSource;
    const { host, ui, input, entry } = setup({ source });
    void host.play(entry, null);
    await started(host);
    input.state.problem = 'lost';
    host.begin(1000, 0);
    host.begin(1000 + PAUSE_AFTER_MS + 1, 0);
    expect(host.phase).toBe('paused');
    ui.howTo(true);
    input.state.problem = 'none';
    host.begin(3000, 0);
    host.begin(3000 + RESUME_AFTER_MS, 0);
    expect(host.phase).toBe('paused');
    ui.howTo(false);
    host.begin(4000, 0);
    host.begin(4000 + RESUME_AFTER_MS, 0);
    expect(host.phase).toBe('playing');
  });

  it('ignores the overlay when no round is playing and clears it on quit', async () => {
    const { host, ui, loop, entry } = setup();
    ui.howTo(true);
    expect(host.phase).toBe('idle');
    expect(loop.paused).toBe(false);
    void host.play(entry, null);
    await started(host);
    ui.howTo(true);
    host.quit();
    expect(host.phase).toBe('idle');
    expect(loop.paused).toBe(false);
    ui.howTo(false);
    expect(host.phase).toBe('idle');
  });

  it('a normal round gets tutorial false, a no-op coach and a no-op finishTutorial', async () => {
    const { host, entry, getCtx } = setup({ meta: { ...meta, hasTutorial: true } });
    const done = host.play(entry, null);
    await started(host);
    const ctx = getCtx();
    expect(ctx.tutorial).toBe(false);
    expect(ctx.coach).toBe(NO_COACH);
    ctx.finishTutorial();
    expect(host.phase).toBe('playing');
    ctx.finish(RESULT);
    await expect(done).resolves.toBe(RESULT);
  });
});

describe('SportHost tutorial', () => {
  const tutorialMeta: SportMeta = { ...meta, hasTutorial: true };

  it('runs in tutorial mode only when the sport has a tutorial', async () => {
    const plain = setup();
    void plain.host.play(plain.entry, null, { tutorial: true });
    await started(plain.host);
    expect(plain.getCtx().tutorial).toBe(false);
    expect(plain.getCtx().coach).toBe(NO_COACH);

    const t = setup({ meta: tutorialMeta });
    void t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    expect(t.getCtx().tutorial).toBe(true);
    expect(t.getCtx().coach).toBe(t.ui.coach);
  });

  it('tells the UI it is a tutorial round', async () => {
    const t = setup({ meta: tutorialMeta });
    const showPlaying = vi.fn();
    t.ui.showPlaying = showPlaying;
    void t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    expect(showPlaying).toHaveBeenCalledWith(tutorialMeta, { tutorial: true });
  });

  it('finishTutorial resolves with the tutorial marker and hides the coach', async () => {
    const t = setup({ meta: tutorialMeta });
    const done = t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    t.getCtx().finishTutorial();
    t.getCtx().finishTutorial();
    await expect(done).resolves.toBe(TUTORIAL_DONE);
    expect(TUTORIAL_DONE.saveScore).toBe(false);
    expect(t.host.phase).toBe('finished');
    expect(t.ui.coach.hide).toHaveBeenCalled();
  });

  it('a stray finish() in a tutorial ends the tutorial and never yields a result', async () => {
    const t = setup({ meta: tutorialMeta });
    const done = t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    t.getCtx().finish({ score: 99, headline: 'oops' });
    await expect(done).resolves.toBe(TUTORIAL_DONE);
    expect(t.host.result).toBe(TUTORIAL_DONE);
  });

  it('End tutorial from the interface ends a tutorial round and does nothing in a normal one', async () => {
    const normal = setup({ meta: tutorialMeta });
    void normal.host.play(normal.entry, null);
    await started(normal.host);
    normal.ui.endTutorial();
    expect(normal.host.phase).toBe('playing');

    const t = setup({ meta: tutorialMeta });
    const done = t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    t.ui.endTutorial();
    await expect(done).resolves.toBe(TUTORIAL_DONE);
    expect(t.host.phase).toBe('finished');
  });

  it('the out-of-frame pause still applies in a tutorial', async () => {
    const source = { kind: 'camera' } as unknown as LandmarkSource;
    const t = setup({ source, meta: tutorialMeta });
    void t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    t.input.state.problem = 'lost';
    t.host.begin(1000, 0);
    t.host.begin(1000 + PAUSE_AFTER_MS + 1, 0);
    expect(t.host.phase).toBe('paused');
    expect(t.getCtx().paused).toBe(true);
  });
});

describe('SportHost hand crops for overlays', () => {
  const poseOnly: SportMeta = {
    ...meta,
    requiredTrackers: { pose: true, handCrops: false, fullFrameHands: false },
  };
  const POSE_ONLY = poseOnly.requiredTrackers;
  const WITH_HANDS = { pose: true, handCrops: true, fullFrameHands: false };

  it('withHandCrops adds crops to a pose-only need and leaves the others alone', () => {
    expect(withHandCrops(POSE_ONLY)).toEqual(WITH_HANDS);
    const hands = { pose: false, handCrops: false, fullFrameHands: true };
    expect(withHandCrops(hands)).toBe(hands);
    const both = { pose: true, handCrops: true, fullFrameHands: false };
    expect(withHandCrops(both)).toBe(both);
  });

  it('requests hand crops while the how-to overlay is up and restores the sport needs after', async () => {
    const { host, ui, input, entry } = setup({ meta: poseOnly });
    void host.play(entry, null);
    await started(host);
    expect(input.setNeeds).toHaveBeenLastCalledWith(POSE_ONLY);
    input.setNeeds.mockClear();
    ui.howTo(true);
    expect(input.setNeeds).toHaveBeenCalledTimes(1);
    expect(input.setNeeds).toHaveBeenLastCalledWith(WITH_HANDS);
    ui.howTo(false);
    expect(input.setNeeds).toHaveBeenCalledTimes(2);
    expect(input.setNeeds).toHaveBeenLastCalledWith(POSE_ONLY);
  });

  it('requests hand crops for the out-of-frame pause and restores the needs when play resumes', async () => {
    const source = { kind: 'camera' } as unknown as LandmarkSource;
    const { host, input, entry } = setup({ source, meta: poseOnly });
    void host.play(entry, null);
    await started(host);
    input.setNeeds.mockClear();
    input.state.problem = 'lost';
    host.begin(1000, 0);
    host.begin(1000 + PAUSE_AFTER_MS + 1, 0);
    expect(input.setNeeds).toHaveBeenLastCalledWith(WITH_HANDS);
    input.state.problem = 'none';
    host.begin(3000, 0);
    host.begin(3000 + RESUME_AFTER_MS, 0);
    expect(host.phase).toBe('playing');
    expect(input.setNeeds).toHaveBeenLastCalledWith(POSE_ONLY);
    expect(input.setNeeds).toHaveBeenCalledTimes(2);
  });

  it('keeps hand crops on while the results or the tutorial-done screen is up', async () => {
    const { host, input, entry, getCtx } = setup({ meta: { ...poseOnly, hasTutorial: true } });
    const done = host.play(entry, null);
    await started(host);
    input.setNeeds.mockClear();
    getCtx().finish(RESULT);
    await done;
    expect(input.setNeeds).toHaveBeenLastCalledWith(WITH_HANDS);
    host.release();

    const t = setup({ meta: { ...poseOnly, hasTutorial: true } });
    const tutorialDone = t.host.play(t.entry, null, { tutorial: true });
    await started(t.host);
    t.input.setNeeds.mockClear();
    t.getCtx().finishTutorial();
    await tutorialDone;
    expect(t.input.setNeeds).toHaveBeenLastCalledWith(WITH_HANDS);
  });

  it('a sport that already has hand crops has nothing to restore afterwards', async () => {
    const { host, ui, input, entry } = setup();
    void host.play(entry, null);
    await started(host);
    input.setNeeds.mockClear();
    ui.howTo(true);
    expect(input.setNeeds).toHaveBeenCalledTimes(1);
    expect(input.setNeeds).toHaveBeenLastCalledWith(meta.requiredTrackers);
    ui.howTo(false);
    expect(input.setNeeds).toHaveBeenCalledTimes(1);
  });

  it('does not touch the trackers when no round is live', () => {
    const { ui, input } = setup();
    ui.howTo(true);
    ui.howTo(false);
    expect(input.setNeeds).not.toHaveBeenCalled();
  });
});
