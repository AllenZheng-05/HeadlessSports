import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import './ui.css';
import type { GateReport } from '../core/gate/types';
import type { SportMeta } from '../core/sport';
import type { FrameProblem, InputProvider } from '../input/types';
import type { TrackingErrorCode } from '../tracking/types';
import { createAudioKit } from './audio';
import { h } from './dom';
import { detectBrowser } from './format';
import { HandCursor } from './handCursor';
import { createHud } from './hud';
import { CameraIndicator, Mirror } from './mirror';
import type { LoadingScreen } from './screens/basic';
import {
  buildCameraError,
  buildCameraIntro,
  buildGateFail,
  buildGateWarning,
  buildLoading,
  buildTitle,
} from './screens/basic';
import { buildCalibration } from './screens/calibration';
import { buildHowTo, buildMenu, buildTutorialDone } from './screens/menu';
import { buildHowToOverlay, buildPlaying, buildResults, createPause } from './screens/playing';
import type { HowToOverlay } from './screens/playing';
import type { ScreenHost, ScreenSpec } from './screens/shared';
import { createCoach } from './coach';
import { createTunables } from './tunablesPanel';
import type {
  CalibrationScreen,
  HowToChoice,
  HowToOptions,
  PlayingOptions,
  ResultsOutcome,
  TutorialDoneChoice,
  Ui,
} from './types';

export interface UiOptions {
  /** Show the tunables panel. */
  debug?: boolean;
  /** Default: from prefers-reduced-motion. */
  reducedMotion?: boolean;
}

interface Watcher {
  fn: (input: InputProvider | null) => (() => void) | void;
  cleanup: (() => void) | void;
}

const REFRESH_AFTER_ENTRANCE_MS = 450;

export function createUi(root: HTMLElement, options: UiOptions = {}): Ui {
  const reduced =
    options.reducedMotion ??
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const container = h('div', 'hs-ui');
  container.dataset.reducedMotion = String(reduced);
  root.append(container);

  const audio = createAudioKit();
  const hud = createHud(container);
  const mirror = new Mirror((aspect) =>
    container.style.setProperty('--mirror-aspect', String(aspect)),
  );
  container.append(mirror.el);
  let offHandler: (() => void) | null = null;
  let quitHandler: (() => void) | null = null;
  let howToPlayHandler: ((open: boolean) => void) | null = null;
  let tutorialEndHandler: (() => void) | null = null;
  let onHandler: (() => void) | null = null;
  let onAvailable = false;
  /** The pause overlay is showing (the round is paused for a frame problem). */
  let pauseShown = false;
  let overlay: HowToOverlay | null = null;
  /** The current screen is one of the lobby screens (title, menu, how-to, results). */
  let lobbyScreen = false;
  let playButtons: HTMLElement[] = [];
  const camera = new CameraIndicator(() => offHandler?.());
  const cameraOn = h('button', 'camera-on btn btn-small btn-secondary', 'Turn camera on');
  cameraOn.type = 'button';
  cameraOn.setAttribute('data-ui', '');
  cameraOn.hidden = true;
  cameraOn.addEventListener('click', () => onHandler?.());
  if (options.debug === true) cameraOn.classList.add('with-tunables');
  container.append(cameraOn);
  container.append(camera.el);
  const tip = h('p', 'cursor-tip', 'Point at a button and make a fist to choose it.');
  tip.hidden = true;
  container.append(tip);
  const pause = createPause(container);
  const coach = createCoach(container, () => tutorialEndHandler?.());
  /** The round on screen is a sport's tutorial. */
  let tutorialPlaying = false;
  const layer = h('div', 'screen-layer');
  container.append(layer);
  const cursor = new HandCursor(container);
  const tunables = createTunables(container, options.debug === true);

  let input: InputProvider | null = null;
  let current: ScreenSpec | null = null;
  let loading: LoadingScreen | null = null;
  let buttons: HTMLElement[] = [];
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const watchers = new Set<Watcher>();

  const host: ScreenHost = {
    audio,
    mirror,
    camera,
    watchInput(fn) {
      const w: Watcher = { fn, cleanup: undefined };
      w.cleanup = fn(input);
      watchers.add(w);
      return () => {
        w.cleanup?.();
        watchers.delete(w);
      };
    },
  };

  function closeOverlay(): void {
    const o = overlay;
    if (!o) return;
    overlay = null;
    o.el.remove();
    cursor.setRevealNear(current?.revealNear === true);
    cursor.setButtons(playButtons);
    current?.cursorButtons?.[0]?.focus({ preventScroll: true });
    howToPlayHandler?.(false);
  }

  function openOverlay(meta: SportMeta): void {
    if (overlay) return;
    const o = buildHowToOverlay(
      meta,
      input?.source === null,
      closeOverlay,
      tutorialPlaying
        ? {
            skip: () => {
              closeOverlay();
              coach.requestSkip();
            },
            end: () => {
              closeOverlay();
              coach.requestEnd();
            },
          }
        : undefined,
    );
    overlay = o;
    container.append(o.el);
    playButtons = current?.cursorButtons ?? [];
    cursor.setRevealNear(false);
    cursor.setButtons([o.resume, ...o.extras]);
    o.resume.focus({ preventScroll: true });
    howToPlayHandler?.(true);
  }

  function unmount(): void {
    closeOverlay();
    tutorialPlaying = false;
    coach.setActive(false);
    container.dataset.tutorial = 'false';
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    const s = current;
    if (!s) return;
    current = null;
    s.dispose?.();
    s.el.remove();
    cameraOn.hidden = true;
    mirror.setMode('hidden');
    mirror.setGuide(null);
    container.append(mirror.el);
    container.append(camera.el);
    camera.el.classList.remove('inline', 'corner', 'in-card');
    hud.setVisible(false);
    camera.setVisible(false);
    buttons = [];
    cursor.setButtons(buttons);
  }

  /**
   * The camera-on indicator and its off button show on every screen while the camera is active
   * (the camera runs on the menu, how-to and results screens too). Screens that do not lay it out
   * themselves (play, calibration) get it in the top-left corner.
   */
  function syncCamera(): void {
    const own = current?.camera === true;
    const card = current?.cameraInCard === true ? current.el.querySelector('.card') : null;
    if (card !== null && camera.el.parentElement !== card) card.append(camera.el);
    camera.el.classList.toggle('in-card', card !== null);
    camera.el.classList.toggle('corner', !own && card === null);
    camera.setVisible(own || (current !== null && camera.isActive));
  }

  const LOBBY = [
    'screen-title',
    'screen-menu',
    'screen-howto',
    'screen-results',
    'screen-tutorialdone',
  ];

  /** "Turn camera on" shows in mouse mode on the lobby screens only, never during a round. */
  function syncCameraOn(): void {
    let lobby = false;
    if (current) for (const c of LOBBY) if (current.el.classList.contains(c)) lobby = true;
    lobbyScreen = lobby;
    cameraOn.hidden = !(onAvailable && lobby);
  }

  /** The hand cursor is off while a round is actually being played. */
  function playActive(): boolean {
    return current?.revealNear === true && overlay === null && !pauseShown;
  }

  function mount(spec: ScreenSpec): void {
    unmount();
    pauseShown = false;
    pause.show(null);
    current = spec;
    layer.append(spec.el);
    spec.onMount?.();
    // Collected before the camera indicator moves into a card: the hand cursor must not be able
    // to switch the camera off by dwelling on it.
    buttons = Array.from(spec.el.querySelectorAll<HTMLElement>('[data-select]'));
    syncCamera();
    syncCameraOn();
    cursor.setRevealNear(spec.revealNear === true);
    cursor.setButtons(spec.noCursor ? [] : (spec.cursorButtons ?? buttons));
    refreshTimer = setTimeout(() => cursor.refresh(), REFRESH_AFTER_ENTRANCE_MS);
    const focus = spec.primary ?? buttons[0];
    focus?.focus({ preventScroll: true });
  }

  function prompt<T>(build: (resolve: (value: T) => void) => ScreenSpec): Promise<T> {
    return new Promise<T>((resolve) => {
      let live = true;
      const spec = build((value) => {
        if (live) resolve(value);
      });
      const original = spec.dispose;
      spec.dispose = () => {
        live = false;
        original?.();
      };
      mount(spec);
    });
  }

  const onClick = (e: Event): void => {
    const t = e.target as Element | null;
    if (t?.closest('[data-select]')) audio.play('select');
  };
  container.addEventListener('click', onClick);

  const onKey = (e: KeyboardEvent): void => {
    if (!current) return;
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest?.('.tunables'))) return;
    if (current.onKey?.(e) === true) {
      e.preventDefault();
      return;
    }
    if (overlay && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Enter')) {
      e.preventDefault();
      overlay.resume.focus({ preventScroll: true });
      if (e.key === 'Enter') overlay.resume.click();
      return;
    }
    if (e.key === 'Escape') {
      if (current.onEscape) {
        e.preventDefault();
        current.onEscape();
      }
      return;
    }
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if ((forward || backward) && buttons.length > 0) {
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      const n = buttons.length;
      const next = i < 0 ? (forward ? 0 : n - 1) : (i + (forward ? 1 : n - 1)) % n;
      buttons[next]?.focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Enter' && current.primary) {
      const a = document.activeElement;
      if (!a || a === document.body) {
        e.preventDefault();
        current.primary.click();
      }
    }
  };
  document.addEventListener('keydown', onKey);

  const ui: Ui = {
    hud,
    audio,
    tunables,
    coach,

    update(dt: number, nowMs: number): void {
      // Bots and recordings do not navigate menus; the mouse still works.
      // Mouse: the cursor is the real pointer, not a mapped hand.
      const pointer = input !== null && input.source === null;
      cursor.setPointerMode(pointer);
      cursor.setSuspended(playActive());
      hud.setPointerMode(pointer);
      const kind = input?.source?.kind;
      const botLike = kind === 'synthetic' || kind === 'replay';
      cursor.update(
        current && !current.noCursor && input && !botLike ? input.state : null,
        dt,
        nowMs,
      );
      // Only once a hand has been read: until the hand model is ready a fist cannot select.
      const hands = input?.state.hands;
      const showTip =
        lobbyScreen &&
        kind === 'camera' &&
        hands !== undefined &&
        (hands.left.known || hands.right.known);
      if (tip.hidden === showTip) tip.hidden = !showTip;
      mirror.update(nowMs);
    },

    setInput(next: InputProvider | null): void {
      input = next;
      mirror.setInput(next);
      for (const w of watchers) {
        w.cleanup?.();
        w.cleanup = w.fn(next);
      }
    },

    showLoading(text: string, progress?: number, onCancel?: () => void): void {
      if (loading && current === loading && loading.cancellable === (onCancel !== undefined)) {
        loading.update(text, progress);
        return;
      }
      loading = buildLoading(text, progress, onCancel);
      mount(loading);
    },

    showGateFail(report: GateReport): void {
      mount(buildGateFail(report));
    },

    showGateWarning(report: GateReport): Promise<void> {
      return prompt<void>((resolve) => buildGateWarning(report, resolve));
    },

    showTitle(): Promise<void> {
      return prompt<void>((resolve) => buildTitle(resolve));
    },

    showCameraIntro(): Promise<void> {
      return prompt<void>((resolve) => buildCameraIntro(resolve));
    },

    showCameraError(code: TrackingErrorCode): Promise<'retry' | 'debug'> {
      const browser = detectBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent);
      return prompt<'retry' | 'debug'>((resolve) => buildCameraError(code, browser, resolve));
    },

    showMenu(
      sports: readonly SportMeta[],
      bests: ReadonlyMap<string, number>,
      notice?: string,
    ): Promise<string> {
      return prompt<string>((resolve) => buildMenu(sports, bests, resolve, notice));
    },

    showHowTo(meta: SportMeta, debugInput: boolean, options?: HowToOptions): Promise<HowToChoice> {
      return prompt<HowToChoice>((resolve) => buildHowTo(meta, debugInput, resolve, host, options));
    },

    showCalibration(meta: SportMeta): CalibrationScreen {
      let spec: ScreenSpec | null = null;
      const build = buildCalibration(meta, host, () => {
        if (spec && current === spec) unmount();
      });
      spec = build.spec;
      mount(spec);
      return build.screen;
    },

    showPlaying(meta: SportMeta, options?: PlayingOptions): void {
      const tutorial = options?.tutorial === true;
      const spec = buildPlaying({
        onQuit: () => quitHandler?.(),
        onHowTo: () => openOverlay(meta),
        isOverlayOpen: () => overlay !== null,
        closeOverlay,
        tutorial: tutorial
          ? { skip: () => coach.requestSkip(), buttons: coach.buttons }
          : undefined,
      });
      spec.onMount = () => {
        hud.setVisible(true);
        mirror.setMode('corner');
        tutorialPlaying = tutorial;
        container.dataset.tutorial = String(tutorial);
        coach.setActive(tutorial);
      };
      mount(spec);
    },

    showPause(problem: FrameProblem | null): void {
      pauseShown = problem !== null && problem !== 'none';
      pause.show(problem);
    },

    showResults(
      meta: SportMeta,
      result: Parameters<typeof buildResults>[1],
      outcome: ResultsOutcome,
    ): Promise<'again' | 'menu'> {
      return prompt<'again' | 'menu'>((resolve) => buildResults(meta, result, outcome, resolve));
    },

    showTutorialDone(meta: SportMeta): Promise<TutorialDoneChoice> {
      return prompt<TutorialDoneChoice>((resolve) => buildTutorialDone(meta, resolve));
    },

    onTutorialEnd(handler: () => void): void {
      tutorialEndHandler = handler;
    },

    onCameraOff(handler: () => void): void {
      offHandler = handler;
    },

    onQuit(handler: () => void): void {
      quitHandler = handler;
    },

    onHowToPlay(handler: (open: boolean) => void): void {
      howToPlayHandler = handler;
    },

    setCameraOnAvailable(available: boolean): void {
      onAvailable = available;
      syncCameraOn();
    },

    onCameraOn(handler: () => void): void {
      onHandler = handler;
    },

    setCameraActive(active: boolean): void {
      camera.setActive(active);
      syncCamera();
    },

    dispose(): void {
      unmount();
      for (const w of watchers) w.cleanup?.();
      watchers.clear();
      document.removeEventListener('keydown', onKey);
      container.removeEventListener('click', onClick);
      cursor.dispose();
      mirror.dispose();
      audio.dispose();
      tunables.dispose();
      coach.el.remove();
      hud.clear();
      container.remove();
    },
  };
  return ui;
}
