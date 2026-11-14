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
  buildLoading,
  buildTitle,
} from './screens/basic';
import { buildCalibration } from './screens/calibration';
import { buildHowTo, buildMenu } from './screens/menu';
import { buildPlaying, buildResults, createPause } from './screens/playing';
import type { ScreenHost, ScreenSpec } from './screens/shared';
import { createTunables } from './tunablesPanel';
import type { CalibrationScreen, HowToOptions, ResultsOutcome, Ui } from './types';

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
  const camera = new CameraIndicator(() => offHandler?.());
  container.append(camera.el);
  const pause = createPause(container);
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

  function unmount(): void {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    const s = current;
    if (!s) return;
    current = null;
    s.dispose?.();
    s.el.remove();
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

  function mount(spec: ScreenSpec): void {
    unmount();
    pause.show(null);
    current = spec;
    layer.append(spec.el);
    spec.onMount?.();
    // Collected before the camera indicator moves into a card: the hand cursor must not be able
    // to switch the camera off by dwelling on it.
    buttons = Array.from(spec.el.querySelectorAll<HTMLElement>('[data-select]'));
    syncCamera();
    cursor.setButtons(spec.noCursor ? [] : buttons);
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

    update(dt: number, nowMs: number): void {
      // Bots and recordings do not navigate menus; mouse and keyboard still work.
      const kind = input?.source?.kind;
      const botLike = kind === 'synthetic' || kind === 'replay';
      cursor.update(
        current && !current.noCursor && input && !botLike ? input.state : null,
        dt,
        nowMs,
      );
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

    showHowTo(
      meta: SportMeta,
      debugInput: boolean,
      options?: HowToOptions,
    ): Promise<'start' | 'back'> {
      return prompt<'start' | 'back'>((resolve) =>
        buildHowTo(meta, debugInput, resolve, host, options),
      );
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

    showPlaying(_meta: SportMeta): void {
      const spec = buildPlaying(() => quitHandler?.());
      spec.onMount = () => {
        hud.setVisible(true);
        mirror.setMode('corner');
      };
      mount(spec);
    },

    showPause(problem: FrameProblem | null): void {
      pause.show(problem);
    },

    showResults(
      meta: SportMeta,
      result: Parameters<typeof buildResults>[1],
      outcome: ResultsOutcome,
    ): Promise<'again' | 'menu'> {
      return prompt<'again' | 'menu'>((resolve) => buildResults(meta, result, outcome, resolve));
    },

    onCameraOff(handler: () => void): void {
      offHandler = handler;
    },

    onQuit(handler: () => void): void {
      quitHandler = handler;
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
      hud.clear();
      container.remove();
    },
  };
  return ui;
}
