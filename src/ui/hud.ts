import type { FlashKind, Hud, MeterTone } from '../core/sport';
import { clamp, h } from './dom';
import { PCT_INT, pctTenth } from './format';

interface MeterItem {
  root: HTMLElement;
  icon: HTMLElement;
  label: HTMLElement;
  pct: HTMLElement;
  fill: HTMLElement;
  labelText: string;
  tone: MeterTone;
  pctValue: number;
}

interface CursorItem {
  el: HTMLElement;
  x: number;
  y: number;
  closed: boolean;
  /** Last pixel position written in pointer mode. */
  px: number;
  py: number;
}

const TONE_ICON: Record<MeterTone, string> = {
  neutral: '',
  good: '✓',
  warn: '!',
  bad: '✗',
};

export interface UiHud extends Hud {
  readonly el: HTMLElement;
  setVisible(visible: boolean): void;
  /**
   * Keyboard and mouse input: hand cursors drawn through `setCursor` sit exactly on the real
   * pointer (clientX/clientY), whatever position the sport passes. Camera mode is unchanged.
   */
  setPointerMode(on: boolean): void;
}

/**
 * The in-round overlay. Sports call every setter each frame, so each one compares against the
 * last value and writes to the DOM only on change; nothing here builds strings per call.
 */
export function createHud(parent: HTMLElement): UiHud {
  const el = h('div', 'hud');
  el.hidden = true;

  const scoreEl = h('div', 'hud-score');
  const subEl = h('div', 'hud-sub');
  subEl.hidden = true;
  const topLeft = h('div', 'hud-topleft');
  topLeft.append(scoreEl, subEl);

  const metersEl = h('div', 'hud-meters');
  const tableHost = h('div', 'hud-table-host');
  const bannerEl = h('div', 'hud-banner');
  bannerEl.setAttribute('aria-live', 'polite');
  bannerEl.setAttribute('role', 'status');
  const hintEl = h('div', 'hud-hint');
  hintEl.setAttribute('aria-live', 'polite');
  hintEl.hidden = true;
  const flashEl = h('div', 'hud-flash');
  const cursorLayer = h('div', 'hud-cursors');
  el.append(flashEl, topLeft, metersEl, tableHost, bannerEl, hintEl, cursorLayer);
  parent.append(el);

  let lastScore = '';
  let lastSub: string | null = null;
  let lastHint: string | null = null;
  let bannerText: string | null = null;
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  const meters = new Map<string, MeterItem>();
  const cursors = new Map<string, CursorItem>();

  // table state
  let tableEl: HTMLTableElement | null = null;
  let cells: HTMLElement[][] = [];
  let cellText: string[][] = [];
  let highlight = -1;

  const clearBanner = (): void => {
    bannerTimer = null;
    bannerText = null;
    bannerEl.classList.remove('show');
    bannerEl.textContent = '';
  };

  function setScore(text: string): void {
    if (text === lastScore) return;
    lastScore = text;
    scoreEl.textContent = text;
  }

  function setSubScore(text: string | null): void {
    if (text === lastSub) return;
    lastSub = text;
    if (text === null) {
      subEl.hidden = true;
      subEl.textContent = '';
    } else {
      subEl.hidden = false;
      subEl.textContent = text;
    }
  }

  function setBanner(text: string | null, ms?: number): void {
    if (text === null || text === '') {
      if (bannerTimer !== null) clearTimeout(bannerTimer);
      clearBanner();
      return;
    }
    if (text === bannerText) return;
    bannerText = text;
    bannerEl.textContent = text;
    bannerEl.dataset.size = text.length > 16 ? 'long' : text.length > 8 ? 'mid' : 'short';
    // restart the squash-and-stretch pop
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    if (bannerTimer !== null) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
    if (ms !== undefined && ms > 0) bannerTimer = setTimeout(clearBanner, ms);
  }

  function setHint(text: string | null): void {
    if (text === lastHint) return;
    lastHint = text;
    if (text === null) {
      hintEl.hidden = true;
      hintEl.textContent = '';
    } else {
      hintEl.hidden = false;
      hintEl.textContent = text;
    }
  }

  function setMeter(id: string, value: number | null, label?: string, tone?: MeterTone): void {
    let m = meters.get(id);
    if (value === null) {
      if (m) {
        m.root.remove();
        meters.delete(id);
      }
      return;
    }
    if (!m) {
      const root = h('div', 'meter');
      const head = h('div', 'meter-head');
      const icon = h('span', 'meter-icon');
      icon.setAttribute('aria-hidden', 'true');
      const lab = h('span', 'meter-label', label ?? id);
      const pct = h('span', 'meter-pct', '0%');
      head.append(icon, lab, pct);
      const bar = h('div', 'meter-bar');
      const fill = h('div', 'meter-fill');
      bar.append(fill);
      root.append(head, bar);
      root.dataset.tone = 'neutral';
      metersEl.append(root);
      m = {
        root,
        icon,
        label: lab,
        pct,
        fill,
        labelText: label ?? id,
        tone: 'neutral',
        pctValue: -1,
      };
      meters.set(id, m);
    }
    if (label !== undefined && label !== m.labelText) {
      m.labelText = label;
      m.label.textContent = label;
    }
    const t = tone ?? 'neutral';
    if (t !== m.tone) {
      m.tone = t;
      m.root.dataset.tone = t;
      m.icon.textContent = TONE_ICON[t];
    }
    const p = Math.round(clamp(value, 0, 1) * 100);
    if (p !== m.pctValue) {
      m.pctValue = p;
      m.pct.textContent = PCT_INT[p] as string;
      m.fill.style.width = PCT_INT[p] as string;
    }
  }

  function removeTable(): void {
    if (tableEl) tableEl.remove();
    tableEl = null;
    cells = [];
    cellText = [];
    highlight = -1;
  }

  function structureMatches(rows: readonly (readonly string[])[]): boolean {
    if (!tableEl || rows.length !== cells.length) return false;
    for (let r = 0; r < rows.length; r++) {
      if ((rows[r] as readonly string[]).length !== (cells[r] as HTMLElement[]).length) {
        return false;
      }
    }
    return true;
  }

  function setTable(rows: readonly (readonly string[])[] | null, highlightColumn = -1): void {
    if (rows === null) {
      removeTable();
      return;
    }
    if (!structureMatches(rows)) {
      removeTable();
      tableEl = h('table', 'hud-table');
      const body = h('tbody');
      for (let r = 0; r < rows.length; r++) {
        const src = rows[r] as readonly string[];
        const tr = h('tr');
        const rowCells: HTMLElement[] = [];
        const rowText: string[] = [];
        for (const text of src) {
          const td = h(r === 0 ? 'th' : 'td', '', text);
          tr.append(td);
          rowCells.push(td);
          rowText.push(text);
        }
        cells.push(rowCells);
        cellText.push(rowText);
        body.append(tr);
      }
      tableEl.append(body);
      tableHost.append(tableEl);
      highlight = -1;
    } else {
      for (let r = 0; r < rows.length; r++) {
        const src = rows[r] as readonly string[];
        const texts = cellText[r] as string[];
        const rowCells = cells[r] as HTMLElement[];
        for (let c = 0; c < src.length; c++) {
          if (texts[c] !== src[c]) {
            texts[c] = src[c] as string;
            (rowCells[c] as HTMLElement).textContent = src[c] as string;
          }
        }
      }
    }
    if (highlightColumn !== highlight) {
      for (const rowCells of cells) {
        if (highlight >= 0 && highlight < rowCells.length) {
          (rowCells[highlight] as HTMLElement).classList.remove('hl');
        }
        if (highlightColumn >= 0 && highlightColumn < rowCells.length) {
          (rowCells[highlightColumn] as HTMLElement).classList.add('hl');
        }
      }
      highlight = highlightColumn;
    }
  }

  function flash(kind: FlashKind): void {
    flashEl.dataset.kind = kind;
    flashEl.classList.remove('go');
    void flashEl.offsetWidth;
    flashEl.classList.add('go');
  }

  let pointerMode = false;
  let hasPointer = false;
  let pointerX = 0;
  let pointerY = 0;
  const onPointer = (e: PointerEvent): void => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    hasPointer = true;
  };

  function setPointerMode(on: boolean): void {
    if (on === pointerMode) return;
    pointerMode = on;
    if (on) window.addEventListener('pointermove', onPointer, true);
    else window.removeEventListener('pointermove', onPointer, true);
    // Force every cursor to be repositioned in the new coordinate system.
    for (const c of cursors.values()) {
      c.x = -1;
      c.y = -1;
      c.px = -1;
      c.py = -1;
    }
  }

  function setCursor(id: string, x: number | null, y: number, closed = false): void {
    let c = cursors.get(id);
    if (x === null) {
      if (c) {
        c.el.remove();
        cursors.delete(id);
      }
      return;
    }
    if (!c) {
      const node = h('div', 'hud-cursor');
      node.setAttribute('aria-hidden', 'true');
      cursorLayer.append(node);
      c = { el: node, x: -1, y: -1, closed: false, px: -1, py: -1 };
      cursors.set(id, c);
    }
    if (pointerMode) {
      c.el.hidden = !hasPointer;
      const qx = Math.round(pointerX);
      const qy = Math.round(pointerY);
      if (c.px !== qx) {
        c.px = qx;
        c.el.style.left = `${qx}px`;
      }
      if (c.py !== qy) {
        c.py = qy;
        c.el.style.top = `${qy}px`;
      }
      if (c.closed !== closed) {
        c.closed = closed;
        c.el.classList.toggle('closed', closed);
      }
      return;
    }
    c.el.hidden = false;
    if (c.x !== x) {
      c.x = x;
      c.el.style.left = pctTenth(x);
    }
    if (c.y !== y) {
      c.y = y;
      c.el.style.top = pctTenth(y);
    }
    if (c.closed !== closed) {
      c.closed = closed;
      c.el.classList.toggle('closed', closed);
    }
  }

  function clear(): void {
    if (bannerTimer !== null) clearTimeout(bannerTimer);
    clearBanner();
    setScore('');
    setSubScore(null);
    setHint(null);
    for (const m of meters.values()) m.root.remove();
    meters.clear();
    removeTable();
    for (const c of cursors.values()) c.el.remove();
    cursors.clear();
    setPointerMode(false);
    flashEl.classList.remove('go');
  }

  return {
    el,
    setVisible(visible: boolean): void {
      el.hidden = !visible;
    },
    setScore,
    setSubScore,
    setBanner,
    setHint,
    setMeter,
    setTable,
    flash,
    setCursor,
    setPointerMode,
    clear,
  };
}
