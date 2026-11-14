// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTunables, guessRange } from './tunablesPanel';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => host.remove());

function input(path: string, type: string): HTMLInputElement {
  const rows = Array.from(host.querySelectorAll('.tunables-row'));
  const row = rows.find((r) => r.querySelector('.tunables-name')?.textContent === path);
  if (!row) throw new Error(`no row ${path}`);
  const el = row.querySelector<HTMLInputElement>(`input[type="${type}"]`);
  if (!el) throw new Error(`no ${type} input in ${path}`);
  return el;
}

describe('tunables in debug mode', () => {
  it('renders controls and edits write into the object', () => {
    const t = createTunables(host, true);
    const config = { speed: 2, enabled: false, nested: { gain: 0.5, on: true, label: 'x' } };
    t.register('a', 'Sport A', config, { speed: { min: 0, max: 10, step: 0.5 } });
    expect(host.querySelector('h3')?.textContent).toBe('Sport A');
    const slider = input('speed', 'range');
    expect(slider.max).toBe('10');
    expect(slider.step).toBe('0.5');

    const num = input('speed', 'number');
    num.value = '7';
    num.dispatchEvent(new Event('input'));
    expect(config.speed).toBe(7);
    expect(slider.value).toBe('7');

    slider.value = '3';
    slider.dispatchEvent(new Event('input'));
    expect(config.speed).toBe(3);
    expect(num.value).toBe('3');

    const box = input('enabled', 'checkbox');
    box.checked = true;
    box.dispatchEvent(new Event('input'));
    expect(config.enabled).toBe(true);
  });

  it('shows one level of nesting as group.field', () => {
    const t = createTunables(host, true);
    const config = { nested: { gain: 0.5, on: true, label: 'x' } };
    t.register('a', 'A', config);
    const gain = input('nested.gain', 'number');
    gain.value = '0.9';
    gain.dispatchEvent(new Event('input'));
    expect(config.nested.gain).toBe(0.9);
    const on = input('nested.on', 'checkbox');
    on.checked = false;
    on.dispatchEvent(new Event('input'));
    expect(config.nested.on).toBe(false);
    expect(host.textContent).not.toContain('nested.label');
  });

  it('unregister removes the controls', () => {
    const t = createTunables(host, true);
    const off = t.register('a', 'A', { x: 1 });
    t.register('b', 'B', { y: 2 });
    expect(host.querySelectorAll('section').length).toBe(2);
    off();
    expect(host.querySelectorAll('section').length).toBe(1);
    expect(host.querySelector('h3')?.textContent).toBe('B');
  });

  it('has a Copy JSON button per config', () => {
    const t = createTunables(host, true);
    t.register('a', 'A', { x: 1 });
    t.register('b', 'B', { y: 2 });
    const buttons = Array.from(host.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Copy JSON',
    );
    expect(buttons.length).toBe(2);
  });
});

describe('tunables without debug', () => {
  it('renders nothing but register still returns an unregister function', () => {
    const t = createTunables(host, false);
    const off = t.register('a', 'A', { x: 1 });
    expect(host.children.length).toBe(0);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

describe('guessRange', () => {
  it('gives a range around the value', () => {
    const r = guessRange(0.5);
    expect(r.min).toBeLessThanOrEqual(0.5);
    expect(r.max).toBeGreaterThan(0.5);
    expect(guessRange(0).min).toBeLessThan(0);
    expect(guessRange(-4).max).toBeLessThanOrEqual(0);
    expect(guessRange(120).step).toBe(1);
  });
});
