import { DebugInput } from '../../input/debug/DebugInput';
import { TrackedInput } from '../../input/TrackedInput';
import type { Calibration, InputProvider, Side } from '../../input/types';
import { createRenderer } from '../../render/renderer';
import { createFieldDayScene } from '../../render/style/scene';
import { SPORTS, findSport } from '../../sports/registry';
import { isTrackingError } from '../../tracking/camera/errors';
import { createLandmarkSource } from '../../tracking/createSource';
import type { TrackerNeeds } from '../../tracking/types';
import { createUi } from '../../ui/createUi';
import type { Ui } from '../../ui/types';
import {
  CalibrationSession,
  defaultCalibration,
  measureBrightness,
} from '../calibration/CalibrationSession';
import { cameraOnSearch, parseFlags } from '../flags';
import type { Flags } from '../flags';
import { gateVerdict } from '../gate/evaluate';
import { runGate } from '../gate/runGate';
import { GameLoop } from '../loop';
import { createScoreStore } from '../scores';
import type { ScoreStore } from '../scores';
import { scoreKeyOf } from '../sport';
import type { SportEntry, SportMeta, Stance } from '../sport';
import { IdleInput } from './IdleInput';
import { SportHost } from './SportHost';
import { createHook } from './hook';
import { playRounds } from './playRounds';
import type { GameHook } from './hook';

const POSE_ONLY: TrackerNeeds = { pose: true, handCrops: false, fullFrameHands: false };
/** The lobby and calibration: pose plus hand crops, so the hand cursor can read each hand's fist. */
const POSE_AND_HANDS: TrackerNeeds = { pose: true, handCrops: true, fullFrameHands: false };
const HANDS_ONLY: TrackerNeeds = { pose: false, handCrops: false, fullFrameHands: true };
const BRIGHTNESS_EVERY_MS = 500;
/** How long the calibration screen keeps showing "All set". */
const CALIBRATION_DONE_MS = 600;
/** Shown on the menu after a sport threw. */
const ROUND_BROKE_NOTICE = 'That round broke. Pick a sport to try again.';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Hand-only stances swap the trackers; the rest keep pose and add hands in the background. */
function calibrationNeeds(stance: Stance): TrackerNeeds {
  return stance === 'hands-close' ? HANDS_ONLY : POSE_AND_HANDS;
}

const GATE_WARNED_KEY = 'hs-gate-warned';

function gateWarned(): boolean {
  try {
    return sessionStorage.getItem(GATE_WARNED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberGateWarned(): void {
  try {
    sessionStorage.setItem(GATE_WARNED_KEY, '1');
  } catch {
    // Private mode: the warning may show again after a reload.
  }
}

/** The whole session: boot, gate, title, camera, menu, how-to, calibration, play, results. */
class Shell {
  private readonly hook: GameHook;
  private ui!: Ui;
  private scores!: ScoreStore;
  private host!: SportHost;
  private loop!: GameLoop;
  private input: InputProvider = new IdleInput();
  /** Called every frame after the input has been updated; used by calibration. */
  private perFrame: ((nowMs: number) => void) | null = null;
  /** Bumped when the flow restarts (camera switched off); older chains stop. */
  private epoch = 0;
  /** One-shot message for the next menu (a round broke). */
  private notice: string | null = null;
  /** Dominant hand for mouse play; remembered for the session. */
  private hand: Side;

  constructor(private readonly flags: Flags) {
    this.hand = flags.hand ?? 'right';
    this.hook = createHook(flags);
    window.__game = this.hook;
  }

  async run(): Promise<void> {
    const flags = this.flags;
    const hook = this.hook;
    const uiRoot = document.getElementById('ui');
    const canvas = document.getElementById('game');
    if (!uiRoot || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('The page is missing #ui or #game.');
    }
    this.ui = createUi(uiRoot, { debug: flags.debug });
    this.ui.showLoading('Warming up', 0);
    const renderer = await createRenderer(canvas, flags.renderer);
    this.scores = await createScoreStore();

    hook.phase = 'gate';
    const report = await runGate({
      renderer,
      poseModel: flags.pose,
      skip: flags.skipGate,
      mainThread: flags.mainThread,
      onProgress: (fraction, label) => this.ui.showLoading(label, fraction),
    });
    const verdict = gateVerdict(report, flags.input !== 'debug' && flags.source === 'camera');
    if (verdict !== 'ok') {
      // Wipe the benchmark's last frame (cones and props) behind the card.
      const clean = createFieldDayScene();
      renderer.render(clean.scene, clean.camera);
      clean.dispose();
      if (verdict === 'blocked') {
        hook.phase = 'gate-fail';
        this.ui.showGateFail(report);
        return;
      }
      // A weak device may still try. Once is enough for the page session.
      if (!gateWarned()) {
        hook.phase = 'gate-warning';
        await this.ui.showGateWarning(report);
        rememberGateWarned();
      }
    }

    // The loop starts after the gate: the benchmark measures frame rate and must have the GPU to itself.
    this.loop = new GameLoop(
      {
        begin: (now, dt) => {
          this.host.begin(now, dt);
          if (this.perFrame !== null) this.perFrame(now);
        },
        fixed: (dt, now) => this.host.fixed(dt, now),
        frame: (dt, now, alpha) => this.onFrame(dt, now, alpha),
      },
      { timeScale: flags.timeScale },
    );
    this.host = new SportHost({
      renderer,
      ui: this.ui,
      input: this.input,
      scores: this.scores,
      flags,
      loop: this.loop,
    });
    this.ui.onCameraOff(() => this.onCameraOff());
    this.ui.onCameraOn(() => this.onCameraOn());
    // The title shows before any input is attached: mouse mode is already known from the flag.
    this.ui.setCameraOnAvailable(flags.input === 'debug');
    this.renderer = renderer;
    this.loop.start();

    const auto = flags.sport !== null && (flags.input === 'debug' || flags.source !== 'camera');
    if (auto) {
      const entry = findSport(flags.sport as string);
      if (entry === null) throw new Error(`Unknown sport "${flags.sport}".`);
      await this.attachInput(await this.makeInput());
      const epoch = this.epoch;
      await this.playSport(
        entry,
        defaultCalibration(entry.meta.stance, this.hand),
        epoch,
        flags.tutorial,
      );
      if (epoch === this.epoch) await this.menuLoop(epoch);
      return;
    }

    hook.phase = 'title';
    await this.ui.showTitle();
    await this.attachInput(await this.makeInput());
    await this.menuLoop(this.epoch);
  }

  /** Report a fatal problem on screen and in the console; never a blank page. */
  fatal(err: unknown): void {
    console.error(err);
    this.hook.phase = 'error';
    this.hook.error = message(err);
    const text = `Something went wrong: ${message(err)}`;
    try {
      this.ui.showLoading(text);
    } catch {
      const root = document.getElementById('ui');
      if (root) root.textContent = text;
    }
  }

  // ---- per frame ----

  private renderer!: {
    drawCalls(): number;
    memory(): { geometries: number; textures: number };
  };

  private onFrame(dt: number, now: number, alpha: number): void {
    const host = this.host;
    host.frame(dt, now, alpha);
    const hook = this.hook;
    hook.frames++;
    hook.drawCalls = this.renderer.drawCalls();
    const mem = this.renderer.memory();
    hook.rendererMemory.geometries = mem.geometries;
    hook.rendererMemory.textures = mem.textures;
    hook.sport = host.sport;
    const p = host.phase;
    if (p === 'playing' || p === 'paused' || p === 'loading') hook.phase = p;
  }

  // ---- input ----

  private async makeInput(): Promise<InputProvider> {
    const flags = this.flags;
    if (flags.input === 'debug') return this.startDebugInput();
    for (let first = true; ; first = false) {
      const source = await createLandmarkSource(flags);
      const input = new TrackedInput(source);
      try {
        if (source.kind === 'camera') {
          if (first) {
            this.hook.phase = 'camera';
            await this.ui.showCameraIntro();
          }
        }
        // Pose only: the menu must not wait for the hand model. Hand crops are requested after.
        await input.start(POSE_ONLY);
        return input;
      } catch (err) {
        input.stop();
        if (!isTrackingError(err)) throw err;
        this.hook.phase = 'camera';
        const choice = await this.ui.showCameraError(err.code);
        if (choice === 'debug') return this.startDebugInput();
      }
    }
  }

  private async startDebugInput(): Promise<InputProvider> {
    const input = new DebugInput();
    await input.start(POSE_ONLY);
    this.hook.debugInput = input;
    return input;
  }

  private async attachInput(input: InputProvider): Promise<void> {
    const previous = this.input;
    this.input = input;
    if (previous !== input) previous.stop();
    this.host.setInput(input);
    this.ui.setInput(input);
    const kind = input.source === null ? 'debug' : input.source.kind;
    this.hook.inputKind = kind;
    if (kind !== 'debug' && this.hook.debugInput !== null) this.hook.debugInput = null;
    this.ui.setCameraActive(kind === 'camera');
    this.ui.setCameraOnAvailable(kind === 'debug');
  }

  /**
   * "Turn camera on": reload at the same address without the camera-off choice, so the normal
   * flow runs (title, camera intro, permission, gate, menu). A reload is used instead of swapping
   * the input in place because the menu, how-to and results chains are all awaiting UI promises
   * bound to the current input, and a full restart is the one path already proven end to end.
   * If permission is denied the camera error screen offers mouse play again.
   */
  private onCameraOn(): void {
    location.assign(`${location.pathname}${cameraOnSearch(location.search)}${location.hash}`);
  }

  /** The one-click camera-off control: stop tracking, mouse play from here, back to the menu. */
  private onCameraOff(): void {
    const epoch = ++this.epoch;
    // Tears down a loading, running, paused or finished round. A pending calibration is NOT
    // cancelled by clearing perFrame: its next tick sees the new epoch and resolves, so the old
    // menu chain unwinds instead of leaking.
    this.host.quit();
    void (async () => {
      await this.attachInput(await this.startDebugInput());
      await this.menuLoop(epoch);
    })().catch((err: unknown) => this.fatal(err));
  }

  // ---- menu and rounds ----

  private async bests(metas: readonly SportMeta[]): Promise<Map<string, number>> {
    const bests = new Map<string, number>();
    for (const meta of metas) {
      const best = await this.scores.best(scoreKeyOf(meta), meta.score.higherIsBetter);
      if (best !== null) bests.set(meta.id, best.score);
    }
    return bests;
  }

  /** Ask for hand crops without waiting: the cursor can select by fist once the model is ready. */
  private requestHands(input: InputProvider): void {
    input.setNeeds(POSE_AND_HANDS).catch(() => undefined);
  }

  private async menuLoop(epoch: number): Promise<void> {
    this.requestHands(this.input);
    for (;;) {
      if (epoch !== this.epoch) return;
      let entries: readonly SportEntry[] = SPORTS;
      if (entries.length === 0) {
        const warmup = findSport('warmup');
        entries = warmup === null ? [] : [warmup];
      }
      const metas = entries.map((e) => e.meta);
      const bests = await this.bests(metas);
      this.hook.phase = 'menu';
      this.hook.sportId = null;
      const notice = this.notice ?? undefined;
      this.notice = null;
      const id = await this.ui.showMenu(metas, bests, notice);
      if (epoch !== this.epoch) return;
      const entry = entries.find((e) => e.meta.id === id);
      if (entry === undefined) continue;

      this.hook.phase = 'howto';
      const choice = await this.ui.showHowTo(
        entry.meta,
        this.input.source === null,
        this.input.source?.kind === 'camera' || entry.meta.usesHandedness === false
          ? undefined
          : {
              handedness: this.hand,
              onHandedness: (side) => {
                this.hand = side;
              },
            },
      );
      if (epoch !== this.epoch) return;
      if (choice === 'back') continue;

      // Tutorial goes through the same pre-round path as a normal round (calibration included).
      const calibration = await this.calibrate(entry.meta, epoch);
      if (epoch !== this.epoch) return;
      await this.playSport(entry, calibration, epoch, choice === 'tutorial');
    }
  }

  /** Camera input measures the player; every other input gets a sensible default. */
  private async calibrate(meta: SportMeta, epoch: number): Promise<Calibration> {
    const input = this.input;
    const video = input.source?.kind === 'camera' ? input.source.video : null;
    if (input.source?.kind !== 'camera') return defaultCalibration(meta.stance, this.hand);

    const needs = calibrationNeeds(meta.stance);
    // Only a tracker swap is awaited; adding hand crops to a running pose never delays calibration.
    if (needs.pose) this.requestHands(input);
    else await input.setNeeds(needs);
    if (epoch !== this.epoch) return defaultCalibration(meta.stance);
    this.hook.phase = 'calibration';
    const usesHandedness = meta.usesHandedness !== false;
    let session = new CalibrationSession(meta.stance, { usesHandedness });
    const screen = this.ui.showCalibration(meta);
    if (meta.seatedOk) {
      screen.onSeated?.((seated) => {
        // The seated flag is fixed at construction: start the measurement again with it.
        if (!session.done)
          session = new CalibrationSession(meta.stance, { seated, usesHandedness });
      });
    }
    const scratch = document.createElement('canvas');
    scratch.width = 32;
    scratch.height = 18;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    let skipped = false;
    let pending: ((nowMs: number) => void) | null = null;
    void screen.skipped.then(() => {
      skipped = true;
    });

    const calibration = await new Promise<Calibration>((resolve) => {
      let lastBrightness = Number.NEGATIVE_INFINITY;
      let doneAt = -1;
      const tick = (now: number): void => {
        if (epoch !== this.epoch) {
          resolve(defaultCalibration(meta.stance));
          return;
        }
        if (video !== null && context !== null && now - lastBrightness >= BRIGHTNESS_EVERY_MS) {
          lastBrightness = now;
          session.setBrightness(measureBrightness(video, context));
        }
        if (doneAt < 0) {
          screen.set(session.update(input.state, now));
          if (session.done) doneAt = now;
          else if (skipped) {
            session.skip(input.state);
            doneAt = now;
          }
        } else if (now - doneAt >= CALIBRATION_DONE_MS) {
          resolve(session.result() ?? defaultCalibration(meta.stance));
        }
      };
      this.perFrame = tick;
      pending = tick;
    });
    if (this.perFrame === pending) this.perFrame = null;
    screen.close();
    return calibration;
  }

  /**
   * Play rounds of one sport until the player goes back to the menu. After a tutorial, "Play now"
   * starts a normal round with the calibration measured for this visit (no second calibration).
   */
  private async playSport(
    entry: SportEntry,
    calibration: Calibration | null,
    epoch: number,
    tutorial: boolean,
  ): Promise<void> {
    const meta = entry.meta;
    this.input.setCalibration(calibration);
    this.hook.sportId = meta.id;
    const end = await playRounds(
      {
        host: this.host,
        ui: this.ui,
        scores: this.scores,
        hook: this.hook,
        isCurrent: () => epoch === this.epoch,
      },
      entry,
      calibration,
      tutorial,
    );
    if (end === 'stale') return;
    if (end === 'failed') this.notice = ROUND_BROKE_NOTICE;
    this.host.release();
    this.hook.sportId = null;
    this.hook.tutorial = false;
    // Back in the lobby. A sport that ran without pose needs it back (awaited); hand crops follow
    // in the background so the menu is never held up by the hand model.
    if (!meta.requiredTrackers.pose || meta.requiredTrackers.fullFrameHands) {
      await this.input.setNeeds(POSE_ONLY);
    }
    this.requestHands(this.input);
  }
}

export async function boot(): Promise<void> {
  const shell = new Shell(parseFlags(location.search));
  try {
    await shell.run();
  } catch (err) {
    shell.fatal(err);
  }
}
