import type { Calibration, InputProvider } from '../../input/types';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import type { RendererHandle } from '../../render/renderer';
import { BlobShadow } from '../../render/style/blobShadow';
import { createFieldDayScene } from '../../render/style/scene';
import type { FieldDayScene } from '../../render/style/scene';
import type { SyntheticSource } from '../../tracking/synthetic/SyntheticSource';
import type { ScriptStep } from '../../tracking/synthetic/script';
import type { Ui } from '../../ui/types';
import type { Flags } from '../flags';
import type { GameLoop } from '../loop';
import { mulberry32 } from '../random';
import type { ScoreStore } from '../scores';
import type { RoundResult, Sport, SportContext, SportEntry } from '../sport';
import { Lobby } from './Lobby';

export type HostPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'finished';

export interface SportHostDeps {
  renderer: RendererHandle;
  ui: Ui;
  input: InputProvider;
  scores: ScoreStore;
  flags: Flags;
  loop: GameLoop;
}

/** The camera has to report a problem this long before the round pauses. */
export const PAUSE_AFTER_MS = 700;
/** The problem has to stay gone this long before the round resumes. */
export const RESUME_AFTER_MS = 300;

interface Round {
  resolve(result: RoundResult | null): void;
  finished: boolean;
  settled: boolean;
}

/**
 * Owns the stage of the current round (or the idle lobby behind the menus), runs the sport's
 * callbacks, pauses for camera problems and survives a broken sport. One instance per session.
 */
export class SportHost {
  phase: HostPhase = 'idle';
  result: RoundResult | null = null;
  /** The live sport object, for tests and debugging. */
  sport: Sport | null = null;

  private readonly renderer: RendererHandle;
  private readonly ui: Ui;
  private input: InputProvider;
  private readonly scores: ScoreStore;
  private readonly flags: Flags;
  private readonly loop: GameLoop;
  private readonly lobby = new Lobby();
  private stage: FieldDayScene | null = null;
  private avatar: AvatarRig | null = null;
  private shadow: BlobShadow | null = null;
  private round: Round | null = null;
  private generation = 0;
  private problemSinceMs = -1;
  private clearSinceMs = -1;
  private inputErrorLogged = false;
  private readonly onResize = (): void => this.resize();

  constructor(deps: SportHostDeps) {
    this.renderer = deps.renderer;
    this.ui = deps.ui;
    this.input = deps.input;
    this.scores = deps.scores;
    this.flags = deps.flags;
    this.loop = deps.loop;
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.ui.onQuit(() => this.quit());
  }

  /** Swap the input provider between rounds (camera switched off, camera error fallback). */
  setInput(input: InputProvider): void {
    this.input = input;
  }

  /**
   * Load the sport module, build a fresh stage + avatar + blob shadow, set tracker needs, wire the
   * bot when the source is synthetic, start the round. Resolves when the round finishes (with the
   * result) or is quit or broken (null).
   */
  play(entry: SportEntry, calibration: Calibration | null): Promise<RoundResult | null> {
    this.teardown();
    const gen = this.generation;
    const round: Round = { resolve: () => undefined, finished: false, settled: false };
    const done = new Promise<RoundResult | null>((resolve) => {
      round.resolve = resolve;
    });
    this.round = round;
    this.phase = 'loading';
    this.result = null;
    void this.startRound(entry, calibration, gen, round);
    return done;
  }

  /** Leave the current round (Escape, quit control). Resolves `play` with null. */
  quit(): void {
    if (this.phase === 'idle' || this.phase === 'finished') return;
    this.teardown();
  }

  /** Back to the lobby after the results screen. */
  release(): void {
    this.teardown();
  }

  /** Called by the shell's loop callbacks. */
  begin(nowMs: number, _dt: number): void {
    try {
      this.input.update(nowMs);
    } catch (err) {
      if (this.sport !== null) this.fail(err);
      else if (!this.inputErrorLogged) {
        this.inputErrorLogged = true;
        console.error('Input update failed', err);
      }
    }
    if (this.phase === 'playing' || this.phase === 'paused') this.checkPause(nowMs);
  }

  fixed(dt: number, nowMs: number): void {
    if (this.phase !== 'playing' || this.sport === null) return;
    try {
      this.sport.fixedUpdate(dt, nowMs);
    } catch (err) {
      this.fail(err);
    }
  }

  frame(dt: number, nowMs: number, alpha: number): void {
    const sport = this.sport;
    if (sport !== null && this.stage !== null && this.avatar !== null && this.shadow !== null) {
      try {
        sport.frame(dt, nowMs, alpha);
      } catch (err) {
        this.fail(err);
        return;
      }
      this.avatar.update(dt);
      this.shadow.follow(this.avatar.root);
      this.ui.update(dt, nowMs);
      this.renderer.render(this.stage.scene, this.stage.camera);
    } else {
      this.lobby.frame(dt, nowMs, this.input);
      this.ui.update(dt, nowMs);
      this.renderer.render(this.lobby.stage.scene, this.lobby.stage.camera);
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.teardown();
    this.lobby.dispose();
  }

  // ---- internals ----

  private resize(): void {
    this.renderer.resize();
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.lobby.stage.camera.aspect = aspect;
    this.lobby.stage.camera.updateProjectionMatrix();
    if (this.stage !== null) {
      this.stage.camera.aspect = aspect;
      this.stage.camera.updateProjectionMatrix();
    }
  }

  private checkPause(nowMs: number): void {
    const state = this.input.state;
    if (this.input.source?.kind !== 'camera' || state.problem === 'none') {
      this.problemSinceMs = -1;
      if (this.phase === 'paused') {
        if (this.clearSinceMs < 0) this.clearSinceMs = nowMs;
        if (nowMs - this.clearSinceMs >= RESUME_AFTER_MS) this.resume();
      }
      return;
    }
    this.clearSinceMs = -1;
    if (this.phase === 'paused') return;
    if (this.problemSinceMs < 0) this.problemSinceMs = nowMs;
    if (nowMs - this.problemSinceMs > PAUSE_AFTER_MS) {
      this.phase = 'paused';
      this.loop.paused = true;
      this.ui.showPause(state.problem);
    }
  }

  private resume(): void {
    this.phase = 'playing';
    this.loop.paused = false;
    this.clearSinceMs = -1;
    this.problemSinceMs = -1;
    this.ui.showPause(null);
  }

  private async bestScore(entry: SportEntry): Promise<number | null> {
    try {
      const best = await this.scores.best(entry.meta.id, entry.meta.score.higherIsBetter);
      return best === null ? null : best.score;
    } catch {
      return null;
    }
  }

  private async startRound(
    entry: SportEntry,
    calibration: Calibration | null,
    gen: number,
    round: Round,
  ): Promise<void> {
    const meta = entry.meta;
    try {
      this.ui.showLoading(meta.title);
      const factory = (await entry.load()).default;
      if (gen !== this.generation) return;
      const stage = createFieldDayScene({ accent: meta.accent });
      const avatar = new AvatarRig();
      stage.scene.add(avatar.root);
      const shadow = new BlobShadow(0.55);
      stage.scene.add(shadow.mesh);
      this.stage = stage;
      this.avatar = avatar;
      this.shadow = shadow;
      this.resize();
      const best = await this.bestScore(entry);
      await this.input.setNeeds(meta.requiredTrackers);
      if (gen !== this.generation) return;
      const ctx: SportContext = {
        stage,
        avatar,
        input: this.input,
        hud: this.ui.hud,
        audio: this.ui.audio,
        tunables: this.ui.tunables,
        calibration,
        best,
        random: mulberry32(this.flags.seed),
        debug: this.flags.debug,
        short: this.flags.short,
        finish: (result) => this.finishRound(round, result),
      };
      const sport = await factory(ctx);
      if (gen !== this.generation) {
        sport.dispose();
        return;
      }
      this.sport = sport;
      this.wireBot(sport);
      this.ui.showPlaying(meta);
      this.problemSinceMs = -1;
      this.clearSinceMs = -1;
      if (!round.finished) this.phase = 'playing';
      sport.start();
    } catch (err) {
      if (gen === this.generation) this.fail(err);
      else console.error('Sport failed after it was dismissed', err);
    }
  }

  private wireBot(sport: Sport): void {
    const source = this.input.source;
    if (source === null || source.kind !== 'synthetic') return;
    const synthetic = source as SyntheticSource;
    const bot = sport.createBot();
    // Created once per round, not per call.
    const enqueue = (steps: ScriptStep[]): void => {
      synthetic.queue?.enqueue(steps);
    };
    // The bot's time is game ms (the frame's `t`), not the source's anchor-relative time.
    synthetic.setDirector((_queue, _rel, frameT) => bot.next(enqueue, frameT));
  }

  private finishRound(round: Round, result: RoundResult): void {
    if (round.finished || round !== this.round) return;
    round.finished = true;
    this.result = result;
    this.phase = 'finished';
    this.loop.paused = false;
    this.ui.showPause(null);
    this.settle(round, result);
  }

  private settle(round: Round, result: RoundResult | null): void {
    if (round.settled) return;
    round.settled = true;
    round.resolve(result);
  }

  /** A sport factory or method threw: log, clean up, tell the player, resolve null. */
  private fail(err: unknown): void {
    console.error('Sport failed', err);
    this.teardown();
    this.ui.hud.setBanner('That round broke. Back to the menu.', 2500);
  }

  /** Dispose the round's sport, stage and avatar; back to the lobby; settle `play` with null. */
  private teardown(): void {
    this.generation++;
    const round = this.round;
    this.round = null;
    const sport = this.sport;
    this.sport = null;
    const source = this.input.source;
    if (source !== null && source.kind === 'synthetic' && sport !== null) {
      try {
        (source as SyntheticSource).setDirector(null);
      } catch {
        // Not in director mode: nothing to undo.
      }
    }
    if (sport !== null) {
      try {
        sport.dispose();
      } catch (err) {
        console.error('Sport dispose failed', err);
      }
    }
    if (this.phase !== 'idle') this.ui.hud.clear();
    if (this.phase === 'paused') this.ui.showPause(null);
    this.shadow?.dispose();
    this.avatar?.dispose();
    this.stage?.dispose();
    this.shadow = null;
    this.avatar = null;
    this.stage = null;
    this.loop.paused = false;
    this.phase = 'idle';
    this.problemSinceMs = -1;
    this.clearSinceMs = -1;
    if (round !== null) this.settle(round, null);
  }
}
