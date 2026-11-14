import { DebugInput } from '../../input/debug/DebugInput';
import { TrackedInput } from '../../input/TrackedInput';
import type { Calibration, InputProvider } from '../../input/types';
import { createRenderer } from '../../render/renderer';
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
import { parseFlags } from '../flags';
import type { Flags } from '../flags';
import { runGate } from '../gate/runGate';
import type { GateReport } from '../gate/types';
import { GameLoop } from '../loop';
import { createScoreStore } from '../scores';
import type { ScoreStore } from '../scores';
import type { SportEntry, SportMeta, Stance } from '../sport';
import { IdleInput } from './IdleInput';
import { SportHost } from './SportHost';
import { createHook } from './hook';
import type { GameHook } from './hook';

const POSE_ONLY: TrackerNeeds = { pose: true, handCrops: false, fullFrameHands: false };
const HANDS_ONLY: TrackerNeeds = { pose: false, handCrops: false, fullFrameHands: true };
const BRIGHTNESS_EVERY_MS = 500;
/** How long the calibration screen keeps showing "All set". */
const CALIBRATION_DONE_MS = 600;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function calibrationNeeds(stance: Stance): TrackerNeeds {
  return stance === 'hands-close' ? HANDS_ONLY : POSE_ONLY;
}

/** A gate report whose only failure is a missing camera API is fine when no camera is wanted. */
function gateAcceptable(report: GateReport, flags: Flags): boolean {
  if (report.passed) return true;
  const noCamera = flags.input === 'debug' || flags.source !== 'camera';
  return noCamera && report.failures.length === 1 && report.failures[0] === 'no-camera-api';
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

  constructor(private readonly flags: Flags) {
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
    if (!gateAcceptable(report, flags)) {
      hook.phase = 'gate-fail';
      this.ui.showGateFail(report);
      return;
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
    this.renderer = renderer;
    this.loop.start();

    const auto = flags.sport !== null && (flags.input === 'debug' || flags.source !== 'camera');
    if (auto) {
      const entry = findSport(flags.sport as string);
      if (entry === null) throw new Error(`Unknown sport "${flags.sport}".`);
      await this.attachInput(await this.makeInput());
      const epoch = this.epoch;
      await this.playSport(entry, defaultCalibration(entry.meta.stance), epoch);
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

  private renderer!: { drawCalls(): number };

  private onFrame(dt: number, now: number, alpha: number): void {
    const host = this.host;
    host.frame(dt, now, alpha);
    const hook = this.hook;
    hook.frames++;
    hook.drawCalls = this.renderer.drawCalls();
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
  }

  /** The one-click camera-off control: stop tracking, keyboard and mouse from here, back to the menu. */
  private onCameraOff(): void {
    const epoch = ++this.epoch;
    this.host.quit();
    this.perFrame = null;
    void (async () => {
      await this.attachInput(await this.startDebugInput());
      await this.menuLoop(epoch);
    })().catch((err: unknown) => this.fatal(err));
  }

  // ---- menu and rounds ----

  private async bests(metas: readonly SportMeta[]): Promise<Map<string, number>> {
    const bests = new Map<string, number>();
    for (const meta of metas) {
      const best = await this.scores.best(meta.id, meta.score.higherIsBetter);
      if (best !== null) bests.set(meta.id, best.score);
    }
    return bests;
  }

  private async menuLoop(epoch: number): Promise<void> {
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
      const id = await this.ui.showMenu(metas, bests);
      if (epoch !== this.epoch) return;
      const entry = entries.find((e) => e.meta.id === id);
      if (entry === undefined) continue;

      this.hook.phase = 'howto';
      const choice = await this.ui.showHowTo(entry.meta, this.input.source === null);
      if (epoch !== this.epoch) return;
      if (choice === 'back') continue;

      const calibration = await this.calibrate(entry.meta, epoch);
      if (epoch !== this.epoch) return;
      await this.playSport(entry, calibration, epoch);
    }
  }

  /** Camera input measures the player; every other input gets a sensible default. */
  private async calibrate(meta: SportMeta, epoch: number): Promise<Calibration> {
    const input = this.input;
    const video = input.source?.kind === 'camera' ? input.source.video : null;
    if (input.source?.kind !== 'camera') return defaultCalibration(meta.stance);

    await input.setNeeds(calibrationNeeds(meta.stance));
    if (epoch !== this.epoch) return defaultCalibration(meta.stance);
    this.hook.phase = 'calibration';
    const session = new CalibrationSession(meta.stance);
    const screen = this.ui.showCalibration(meta);
    const scratch = document.createElement('canvas');
    scratch.width = 32;
    scratch.height = 18;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    let skipped = false;
    void screen.skipped.then(() => {
      skipped = true;
    });

    const calibration = await new Promise<Calibration>((resolve) => {
      let lastBrightness = Number.NEGATIVE_INFINITY;
      let doneAt = -1;
      this.perFrame = (now: number): void => {
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
    });
    this.perFrame = null;
    screen.close();
    return calibration;
  }

  /** Play rounds of one sport until the player goes back to the menu. */
  private async playSport(
    entry: SportEntry,
    calibration: Calibration | null,
    epoch: number,
  ): Promise<void> {
    const meta = entry.meta;
    const hook = this.hook;
    this.input.setCalibration(calibration);
    hook.sportId = meta.id;
    for (;;) {
      hook.phase = 'loading';
      hook.result = null;
      hook.isBest = null;
      const result = await this.host.play(entry, calibration);
      if (epoch !== this.epoch) return;
      if (result === null) break;
      const { isBest, best } = await this.scores.add(
        {
          sportId: meta.id,
          score: result.score,
          at: new Date().toISOString(),
          detail: result.detail,
        },
        meta.score.higherIsBetter,
      );
      hook.result = result;
      hook.isBest = isBest;
      hook.phase = 'results';
      const next = await this.ui.showResults(meta, result, { isBest, best: best.score });
      if (epoch !== this.epoch) return;
      if (next === 'menu') break;
    }
    this.host.release();
    this.hook.sportId = null;
    await this.input.setNeeds(POSE_ONLY);
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
