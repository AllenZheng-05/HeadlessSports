import type { AudioKit } from '../../core/sport';
import type { InputProvider } from '../../input/types';
import { h } from '../dom';
import { createLogo } from '../logo';
import type { CameraIndicator, Mirror } from '../mirror';

/** What a screen builder hands back to the screen manager. */
export interface ScreenSpec {
  el: HTMLElement;
  /** Escape = back / quit where the screen has one. */
  onEscape?: () => void;
  /** Called when the screen is replaced; remove any listeners here. */
  dispose?: () => void;
  /** Activated by Enter when nothing is focused; also gets the initial focus. */
  primary?: HTMLElement | null;
  /** Called right after the screen is attached to the page. */
  onMount?: () => void;
  /** The hand cursor stays off on this screen. */
  noCursor?: boolean;
  /** The buttons the hand cursor may select, instead of every `[data-select]` on the screen. */
  cursorButtons?: HTMLElement[];
  /** The hand cursor shows only while the hand is near one of its buttons (play). */
  revealNear?: boolean;
  /** Extra key handling for this screen. Return true when the key was used. */
  onKey?: (e: KeyboardEvent) => boolean;
  /** The screen lays out the camera indicator itself (calibration, play): show it even when off. */
  camera?: boolean;
  /**
   * Show the camera indicator, when the camera is active, in a compact row inside this screen's
   * card instead of the corner of the page (for cards that reach close to the page edge).
   */
  cameraInCard?: boolean;
}

export interface ScreenHost {
  audio: AudioKit;
  mirror: Mirror;
  camera: CameraIndicator;
  /** Runs `fn` now and each time the input provider changes; `fn` may return a cleanup. */
  watchInput(fn: (input: InputProvider | null) => (() => void) | void): () => void;
}

export function screenShell(name: string, cardClass = ''): { el: HTMLElement; card: HTMLElement } {
  const el = h('div', `screen screen-${name}`);
  const card = h('div', `card ${cardClass}`.trim());
  el.append(card);
  return { el, card };
}

export function wordmark(): HTMLElement {
  const w = h('div', 'wordmark');
  w.append(h('span', '', 'Headless'), document.createTextNode(' '), h('span', '', 'Sports'));
  return w;
}

export function logoWithWordmark(size: number): HTMLElement {
  const row = h('div', 'brand');
  row.append(createLogo(size), wordmark());
  return row;
}
