import type { TunableRange, Tunables } from '../core/sport';
import { h } from './dom';

type Bag = Record<string, unknown>;

/** A sensible slider range around the current value when none was registered. */
export function guessRange(value: number): Required<TunableRange> {
  const a = Math.abs(value);
  let step: number;
  if (Number.isInteger(value) && a >= 5) step = a >= 200 ? 10 : 1;
  else if (a === 0) step = 0.01;
  else if (a <= 1) step = 0.01;
  else if (a <= 10) step = 0.1;
  else step = 1;
  if (value === 0) return { min: -1, max: 1, step };
  const span = a * 3;
  return { min: value < 0 ? -span : 0, max: value < 0 ? 0 : span, step };
}

function fieldRows(config: Bag): { path: string; owner: Bag; key: string }[] {
  const rows: { path: string; owner: Bag; key: string }[] = [];
  for (const key of Object.keys(config)) {
    const v = config[key];
    if (typeof v === 'number' || typeof v === 'boolean') {
      rows.push({ path: key, owner: config, key });
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v as Bag;
      for (const k2 of Object.keys(nested)) {
        const v2 = nested[k2];
        if (typeof v2 === 'number' || typeof v2 === 'boolean') {
          rows.push({ path: `${key}.${k2}`, owner: nested, key: k2 });
        }
      }
    }
  }
  return rows;
}

export interface UiTunables extends Tunables {
  dispose(): void;
}

/**
 * Live-editable config objects. With `debug` off, `register` still works but renders nothing.
 */
export function createTunables(parent: HTMLElement, debug: boolean): UiTunables {
  let panel: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  const sections = new Map<string, HTMLElement>();

  if (debug) {
    panel = h('aside', 'tunables');
    panel.setAttribute('aria-label', 'Tunables');
    panel.setAttribute('data-ui', '');
    const head = h('button', 'tunables-toggle', 'Tunables');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'true');
    body = h('div', 'tunables-body');
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      (body as HTMLElement).hidden = !open;
    });
    panel.append(head, body);
    panel.hidden = true;
    parent.append(panel);
  }

  function buildSection(
    title: string,
    config: Bag,
    ranges: Record<string, TunableRange> | undefined,
  ): HTMLElement {
    const section = h('section', 'tunables-config');
    const top = h('div', 'tunables-config-head');
    top.append(h('h3', '', title));
    const copy = h('button', 'tunables-copy', 'Copy JSON');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      const text = JSON.stringify(config, null, 2);
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    });
    top.append(copy);
    section.append(top);

    for (const { path, owner, key } of fieldRows(config)) {
      const row = h('label', 'tunables-row');
      row.append(h('span', 'tunables-name', path));
      const value = owner[key];
      if (typeof value === 'boolean') {
        const box = h('input');
        box.type = 'checkbox';
        box.checked = value;
        box.addEventListener('input', () => {
          owner[key] = box.checked;
        });
        row.append(box);
      } else {
        const r = ranges?.[path] ?? ranges?.[key];
        const g = guessRange(value as number);
        const min = r?.min ?? g.min;
        const max = r?.max ?? g.max;
        const step = r?.step ?? g.step;
        const slider = h('input');
        slider.type = 'range';
        const num = h('input');
        num.type = 'number';
        for (const input of [slider, num]) {
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          input.value = String(value);
        }
        slider.addEventListener('input', () => {
          const n = Number(slider.value);
          owner[key] = n;
          num.value = String(n);
        });
        num.addEventListener('input', () => {
          const n = Number(num.value);
          if (num.value === '' || !Number.isFinite(n)) return;
          owner[key] = n;
          slider.value = String(n);
        });
        row.append(slider, num);
      }
      section.append(row);
    }
    return section;
  }

  return {
    register<T extends object>(
      id: string,
      title: string,
      config: T,
      ranges?: Record<string, TunableRange>,
    ): () => void {
      if (!panel || !body) return () => undefined;
      sections.get(id)?.remove();
      const section = buildSection(title, config as Bag, ranges);
      sections.set(id, section);
      body.append(section);
      panel.hidden = false;
      return () => {
        if (sections.get(id) === section) sections.delete(id);
        section.remove();
        if (panel && sections.size === 0) panel.hidden = true;
      };
    },
    dispose(): void {
      panel?.remove();
      sections.clear();
    },
  };
}
