// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHud } from './hud';
import type { UiHud } from './hud';

let host: HTMLElement;
let hud: UiHud;

function watch(el: HTMLElement): MutationObserver {
  const obs = new MutationObserver(() => undefined);
  obs.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
  return obs;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  hud = createHud(host);
});

afterEach(() => {
  vi.useRealTimers();
  host.remove();
});

describe('hud setters', () => {
  it('score and sub-score create, update and hide', () => {
    hud.setScore('12');
    expect(hud.el.querySelector('.hud-score')?.textContent).toBe('12');
    hud.setScore('13');
    expect(hud.el.querySelector('.hud-score')?.textContent).toBe('13');
    const sub = hud.el.querySelector<HTMLElement>('.hud-sub');
    expect(sub?.hidden).toBe(true);
    hud.setSubScore('Best 20');
    expect(sub?.hidden).toBe(false);
    expect(sub?.textContent).toBe('Best 20');
    hud.setSubScore(null);
    expect(sub?.hidden).toBe(true);
  });

  it('hint shows and hides', () => {
    hud.setHint('Swing');
    const hint = hud.el.querySelector<HTMLElement>('.hud-hint');
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toBe('Swing');
    hud.setHint(null);
    expect(hint?.hidden).toBe(true);
  });

  it('meters are created, updated and removed', () => {
    hud.setMeter('power', 0.5, 'Power', 'good');
    const meter = hud.el.querySelector<HTMLElement>('.meter');
    expect(meter?.dataset.tone).toBe('good');
    expect(meter?.querySelector('.meter-pct')?.textContent).toBe('50%');
    expect(meter?.querySelector('.meter-label')?.textContent).toBe('Power');
    hud.setMeter('power', 0.8, 'Power', 'bad');
    expect(meter?.dataset.tone).toBe('bad');
    expect(meter?.querySelector('.meter-pct')?.textContent).toBe('80%');
    expect(hud.el.querySelectorAll('.meter').length).toBe(1);
    hud.setMeter('power', null);
    expect(hud.el.querySelectorAll('.meter').length).toBe(0);
  });

  it('table builds, updates changed cells and removes', () => {
    hud.setTable(
      [
        ['1', '2'],
        ['X', '7'],
      ],
      1,
    );
    expect(hud.el.querySelectorAll('td').length).toBe(2);
    expect(hud.el.querySelectorAll('.hl').length).toBe(2);
    hud.setTable(
      [
        ['1', '2'],
        ['X', '9'],
      ],
      0,
    );
    const cells = hud.el.querySelectorAll('td');
    expect(cells[1]?.textContent).toBe('9');
    expect(hud.el.querySelectorAll('th.hl').length).toBe(1);
    hud.setTable(null);
    expect(hud.el.querySelector('table')).toBeNull();
  });

  it('cursors are created, moved and removed', () => {
    hud.setCursor('a', 0.25, 0.5, true);
    const c = hud.el.querySelector<HTMLElement>('.hud-cursor');
    expect(c?.style.left).toBe('25%');
    expect(c?.style.top).toBe('50%');
    expect(c?.classList.contains('closed')).toBe(true);
    hud.setCursor('a', 0.3, 0.5, false);
    expect(c?.style.left).toBe('30%');
    expect(c?.classList.contains('closed')).toBe(false);
    hud.setCursor('a', null, 0);
    expect(hud.el.querySelector('.hud-cursor')).toBeNull();
  });

  it('flash sets its kind', () => {
    hud.flash('great');
    expect(hud.el.querySelector<HTMLElement>('.hud-flash')?.dataset.kind).toBe('great');
  });
});

describe('hud change detection', () => {
  it('writes nothing to the DOM when values are unchanged', () => {
    hud.setScore('5');
    hud.setSubScore('sub');
    hud.setHint('hint');
    hud.setMeter('m', 0.4, 'Meter', 'warn');
    hud.setTable([['a', 'b']], 1);
    hud.setCursor('c', 0.1, 0.2, false);
    const obs = watch(hud.el);
    obs.takeRecords();
    for (let i = 0; i < 3; i++) {
      hud.setScore('5');
      hud.setSubScore('sub');
      hud.setHint('hint');
      hud.setMeter('m', 0.4, 'Meter', 'warn');
      hud.setTable([['a', 'b']], 1);
      hud.setCursor('c', 0.1, 0.2, false);
    }
    expect(obs.takeRecords().length).toBe(0);
    obs.disconnect();
  });

  it('writes when a value changes', () => {
    hud.setScore('5');
    const obs = watch(hud.el);
    obs.takeRecords();
    hud.setScore('6');
    expect(obs.takeRecords().length).toBeGreaterThan(0);
    obs.disconnect();
  });
});

describe('banner', () => {
  it('shows text and clears itself after ms', () => {
    vi.useFakeTimers();
    hud.setBanner('Strike!', 1000);
    const banner = hud.el.querySelector<HTMLElement>('.hud-banner');
    expect(banner?.textContent).toBe('Strike!');
    expect(banner?.getAttribute('aria-live')).toBe('polite');
    vi.advanceTimersByTime(999);
    expect(banner?.textContent).toBe('Strike!');
    vi.advanceTimersByTime(2);
    expect(banner?.textContent).toBe('');
  });

  it('stays until replaced when no ms is given, and null clears', () => {
    vi.useFakeTimers();
    hud.setBanner('Go');
    vi.advanceTimersByTime(60000);
    const banner = hud.el.querySelector<HTMLElement>('.hud-banner');
    expect(banner?.textContent).toBe('Go');
    hud.setBanner(null);
    expect(banner?.textContent).toBe('');
  });
});

describe('clear', () => {
  it('removes everything', () => {
    hud.setScore('1');
    hud.setSubScore('x');
    hud.setHint('y');
    hud.setBanner('z');
    hud.setMeter('m', 1);
    hud.setTable([['a']]);
    hud.setCursor('c', 0.5, 0.5);
    hud.clear();
    expect(hud.el.querySelector('.hud-score')?.textContent).toBe('');
    expect(hud.el.querySelector<HTMLElement>('.hud-sub')?.hidden).toBe(true);
    expect(hud.el.querySelector<HTMLElement>('.hud-hint')?.hidden).toBe(true);
    expect(hud.el.querySelector('.hud-banner')?.textContent).toBe('');
    expect(hud.el.querySelectorAll('.meter, table, .hud-cursor').length).toBe(0);
    // and it works again afterwards
    hud.setScore('1');
    expect(hud.el.querySelector('.hud-score')?.textContent).toBe('1');
  });
});
