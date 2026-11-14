/**
 * Shared contract between the game shell and sport modules. Types only.
 *
 * A sport is a folder `src/sports/<id>/` with:
 *   - `meta.ts`      exports `meta: SportMeta` (tiny; imported eagerly by the menu)
 *   - `index.ts`     default-exports a `SportFactory` (lazy-loaded with dynamic import())
 *   - `config.ts`    ONE typed, mutable tunables object, registered through `ctx.tunables`
 *   - pure physics / scoring modules with unit tests
 *
 * Sports consume `ctx.input` (state + events) and never read raw landmarks for gesture logic.
 * The shell owns the renderer, the game loop, onboarding, the HUD elements, scores and menus.
 */

import type { TrackerNeeds } from '../tracking/types';
import type { Calibration, InputProvider } from '../input/types';
import type { AvatarRig } from '../render/avatar/AvatarRig';
import type { FieldDayScene } from '../render/style/scene';
import type { ScriptStep } from '../tracking/synthetic/script';

/** Where the player should be for this sport; selects the calibration guide. */
export type Stance = 'full-body' | 'upper-body' | 'hands-close';

export interface SportMeta {
  /** Folder name and URL id, e.g. 'climbing'. */
  id: string;
  title: string;
  /** One short line for the menu card. */
  tagline: string;
  /** Venue accent colour (hex number). */
  accent: number;
  /** Trackers needed when the round starts. A sport may change needs per phase via ctx.input.setNeeds. */
  requiredTrackers: TrackerNeeds;
  stance: Stance;
  /** Can be played sitting down. */
  seatedOk: boolean;
  /** Show the "clear a 2 by 2 metre space" reminder before starting. */
  needsSpace: boolean;
  score: {
    /** What the number is, e.g. 'Height', 'Score', 'Distance'. */
    label: string;
    /** Unit suffix, e.g. 'm', 'pts', ''. */
    unit: string;
    decimals: number;
    higherIsBetter: boolean;
  };
  /** Two or three short instructions shown before the round. */
  howTo: string[];
  /** Short hints for ?input=debug, e.g. 'Mouse: move hand', 'Q / E: grab'. */
  debugKeys: string[];
}

export interface RoundResult {
  /** The ranked number, in the unit from `meta.score`. */
  score: number;
  /** Big text on the results screen, e.g. '12.4 m', 'Strike!'. */
  headline: string;
  /** Optional extra lines for the results screen. */
  lines?: string[];
  /** Compact numeric summary of the round for later server-side recompute. */
  detail?: Record<string, number>;
}

export type MeterTone = 'neutral' | 'good' | 'warn' | 'bad';
export type FlashKind = 'good' | 'great' | 'bad';

/** DOM overlay elements shared by all sports. All calls are cheap and may be made every frame. */
export interface Hud {
  /** Top-left score readout. Pass a preformatted string. */
  setScore(text: string): void;
  /** Smaller line under the score, e.g. 'Best 12.4 m' or 'Frame 3'. Null hides it. */
  setSubScore(text: string | null): void;
  /** Large centre banner. Stays until replaced, or for `ms` when given. Null clears. */
  setBanner(text: string | null, ms?: number): void;
  /** One-line instruction at the bottom of the screen. Null hides it. */
  setHint(text: string | null): void;
  /** A named bar (stamina, power, foul line). value 0..1; null removes the bar. */
  setMeter(id: string, value: number | null, label?: string, tone?: MeterTone): void;
  /** A small table (bowling scorecard). Rows of cell strings; null removes it. */
  setTable(rows: readonly (readonly string[])[] | null, highlightColumn?: number): void;
  /** Brief full-screen colour pulse for feedback. */
  flash(kind: FlashKind): void;
  /** A 2D marker that follows a normalised screen position (hand cursors). Null hides it. */
  setCursor(id: string, x: number | null, y: number, closed?: boolean): void;
  /** Remove everything this HUD is showing. */
  clear(): void;
}

export type SoundName =
  | 'select'
  | 'tick'
  | 'grab'
  | 'release'
  | 'whoosh'
  | 'thud'
  | 'clatter'
  | 'good'
  | 'great'
  | 'bad'
  | 'cheer';

/** Original synthesised sounds (WebAudio). Silent until the first user gesture unlocks audio. */
export interface AudioKit {
  play(name: SoundName, options?: { pitch?: number; volume?: number }): void;
  setMuted(muted: boolean): void;
}

export interface TunableRange {
  min: number;
  max: number;
  step?: number;
}

/** Live-editable config objects, shown in the debug panel (?debug=1). */
export interface Tunables {
  /**
   * Register a mutable config object. Numeric and boolean fields (one level of nesting allowed)
   * become controls that write straight back into the object. Returns an unregister function.
   */
  register<T extends object>(
    id: string,
    title: string,
    config: T,
    ranges?: Record<string, TunableRange>,
  ): () => void;
}

/**
 * The synthetic player's brain for a sport. The shell calls `next` whenever the synthetic
 * player's move queue is empty; the bot looks at the sport's own state and enqueues the next
 * human-like moves (built from src/tracking/synthetic/scripts/moves.ts). Enqueue an idle move
 * to wait. This keeps headless rounds closed-loop: the bot reacts to the game like a player.
 */
export interface SportBot {
  next(enqueue: (steps: ScriptStep[]) => void, nowMs: number): void;
}

export interface SportContext {
  /** A fresh Field Day scene and camera for this sport to fill. The shell renders it. */
  stage: FieldDayScene;
  /** The player's athlete, already added to the scene at the origin, facing -z. */
  avatar: AvatarRig;
  input: InputProvider;
  hud: Hud;
  audio: AudioKit;
  tunables: Tunables;
  calibration: Calibration | null;
  /** Personal best for this sport before this round, or null. */
  best: number | null;
  /** Seeded random source in [0, 1). Use this, never Math.random, so rounds are reproducible. */
  random(): number;
  /** True when the tunables panel and debug overlays are on. */
  debug: boolean;
  /** Call once when the round is over. The shell saves the score and shows the results screen. */
  finish(result: RoundResult): void;
}

export interface Sport {
  /** Begin the round. Called once, after the factory resolves and the scene is visible. */
  start(): void;
  /** Fixed-timestep simulation at 120 Hz. `dt` is in seconds. Physics and game rules go here. */
  fixedUpdate(dt: number, nowMs: number): void;
  /**
   * Once per rendered frame, after the fixed steps. `alpha` is the fraction of a fixed step
   * left over, for interpolating rendered positions. Drive the avatar and HUD here.
   */
  frame(dt: number, nowMs: number, alpha: number): void;
  /** The closed-loop synthetic player for this sport (used by ?source=synthetic and e2e). */
  createBot(): SportBot;
  /** Remove listeners, scene objects, HUD items and tunables. */
  dispose(): void;
}

export type SportFactory = (ctx: SportContext) => Sport | Promise<Sport>;

/** Registry entry: metadata now, code on demand. */
export interface SportEntry {
  meta: SportMeta;
  load(): Promise<{ default: SportFactory }>;
}
