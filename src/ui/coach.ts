import type { Coach } from '../core/sport';
import { h, selectButton } from './dom';

/** The default confirmation. */
export const DEFAULT_PRAISE = 'Nice';

export interface UiCoach extends Coach {
  readonly el: HTMLElement;
  /** "Skip step" and "End tutorial": reachable by mouse and keyboard, and by the hand cursor while paused. */
  readonly buttons: HTMLElement[];
  /** Live only during a tutorial round. While off, every call is accepted and nothing shows. */
  setActive(active: boolean): void;
  /** The player asked to skip the current step (button, S key or the how-to overlay). */
  requestSkip(): void;
  /** The player asked to end the tutorial. */
  requestEnd(): void;
}

/**
 * The tutorial panel: step counter, one instruction line, an optional detail line, one feedback
 * line and the Skip step / End tutorial buttons. Sports call it every frame, so each setter
 * compares against what is on screen and writes to the DOM only on change.
 */
export function createCoach(parent: HTMLElement, onEnd: () => void): UiCoach {
  const el = h('div', 'coach');
  el.setAttribute('data-ui', '');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Tutorial');
  el.hidden = true;

  const count = h('span', 'coach-count');
  const skip = selectButton('Skip step', 'btn btn-secondary coach-btn coach-skip');
  const end = selectButton('End tutorial', 'btn btn-secondary coach-btn coach-end');
  const buttons = h('div', 'coach-buttons');
  buttons.append(skip, end);
  const top = h('div', 'coach-top');
  top.append(count, buttons);

  const text = h('p', 'coach-text');
  text.setAttribute('role', 'status');
  text.setAttribute('aria-live', 'polite');
  const detail = h('p', 'coach-detail');
  detail.hidden = true;
  const feedback = h('p', 'coach-feedback');
  feedback.hidden = true;
  feedback.setAttribute('role', 'status');
  el.append(top, text, detail, feedback);
  parent.append(el);

  const skipHandlers = new Set<() => void>();
  let active = false;
  let visible = false;
  let confirming = false;
  let shownIndex = -1;
  let shownTotal = -1;
  let shownText = '';
  let shownDetail: string | null = null;
  let shownFeedback: string | null = null;
  let shownPraise: string | null = null;

  const sync = (): void => {
    const on = active && visible;
    if (el.hidden === on) el.hidden = !on;
  };

  const writeFeedback = (value: string | null): void => {
    if (value === shownFeedback) return;
    shownFeedback = value;
    feedback.textContent = value ?? '';
    feedback.hidden = value === null || value === '';
  };

  const writeDetail = (value: string | null): void => {
    if (value === shownDetail) return;
    shownDetail = value;
    detail.textContent = value ?? '';
    detail.hidden = value === null || value === '';
  };

  skip.addEventListener('click', () => api.requestSkip());
  end.addEventListener('click', () => api.requestEnd());

  const api: UiCoach = {
    el,
    buttons: [skip, end],

    setActive(on: boolean): void {
      if (on === active) return;
      active = on;
      if (!on) api.hide();
      sync();
    },

    show(index: number, total: number, line: string, more?: string | null): void {
      if (!active) return;
      visible = true;
      if (confirming) {
        confirming = false;
        shownPraise = null;
        el.dataset.state = 'step';
        // Force the step text back after a confirmation.
        shownText = '';
        shownDetail = '\u0000';
      }
      if (index !== shownIndex || total !== shownTotal) {
        shownIndex = index;
        shownTotal = total;
        count.textContent = `Step ${index + 1} of ${total}`;
      }
      if (line !== shownText) {
        shownText = line;
        text.textContent = line;
      }
      writeDetail(more ?? null);
      sync();
    },

    setFeedback(value: string | null): void {
      if (!active || confirming) return;
      writeFeedback(value);
    },

    confirm(praise?: string): void {
      if (!active) return;
      visible = true;
      const word = praise ?? DEFAULT_PRAISE;
      if (confirming && word === shownPraise) return;
      confirming = true;
      shownPraise = word;
      el.dataset.state = 'confirm';
      text.textContent = word;
      shownText = '';
      writeDetail(null);
      writeFeedback(null);
      sync();
    },

    onSkip(handler: () => void): () => void {
      skipHandlers.add(handler);
      return () => {
        skipHandlers.delete(handler);
      };
    },

    hide(): void {
      visible = false;
      confirming = false;
      shownPraise = null;
      el.dataset.state = 'step';
      shownIndex = -1;
      shownTotal = -1;
      shownText = '';
      text.textContent = '';
      writeDetail(null);
      writeFeedback(null);
      sync();
    },

    requestSkip(): void {
      if (!active) return;
      for (const handler of skipHandlers) handler();
    },

    requestEnd(): void {
      if (!active) return;
      onEnd();
    },
  };
  el.dataset.state = 'step';
  return api;
}
