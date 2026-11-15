import type { PitchKind } from './aim';

/**
 * The mouse play pitch buttons: two large real buttons laid over the canvas, "Fastball" and
 * "Curveball". Styling goes through the CSS object model (the page's CSP forbids inline style
 * markup). They are buttons, so the mouse input does not count a click on them as a game press.
 */
export interface PitchButtons {
  /** Show the buttons in mouse play, hide them otherwise. */
  setShown(on: boolean): void;
  /** Which one is highlighted, and whether they can be clicked. Only touches the DOM on change. */
  update(selected: PitchKind, enabled: boolean): void;
  readonly shown: boolean;
  dispose(): void;
}

const LABEL: Record<PitchKind, string> = { fastball: 'Fastball', curve: 'Curveball' };
const TEST_ID: Record<PitchKind, string> = {
  fastball: 'pitch-fastball',
  curve: 'pitch-curve',
};
const KINDS: readonly PitchKind[] = ['fastball', 'curve'];

const INK = '#1f2a37';
const OFF_BG = '#ffffff';
const ON_BG = '#ffd447';

export function createPitchButtons(onPick: (kind: PitchKind) => void): PitchButtons {
  const root = document.createElement('div');
  root.dataset['testid'] = 'pitch-buttons';
  Object.assign(root.style, {
    position: 'fixed',
    left: '3vw',
    bottom: '3vh',
    zIndex: '12',
    display: 'none',
    flexDirection: 'column',
    gap: '14px',
    pointerEvents: 'none',
  });
  const buttons: Record<PitchKind, HTMLButtonElement> = {
    fastball: document.createElement('button'),
    curve: document.createElement('button'),
  };
  for (const kind of KINDS) {
    const b = buttons[kind];
    b.type = 'button';
    b.textContent = LABEL[kind];
    b.dataset['testid'] = TEST_ID[kind];
    b.tabIndex = -1;
    Object.assign(b.style, {
      pointerEvents: 'auto',
      cursor: 'pointer',
      minWidth: 'clamp(160px, 17vw, 260px)',
      padding: '16px 28px',
      border: `5px solid ${INK}`,
      borderRadius: '24px',
      background: OFF_BG,
      color: INK,
      fontFamily: "'Fredoka', system-ui, sans-serif",
      fontSize: 'clamp(24px, 3.6vh, 38px)',
      fontWeight: '700',
      lineHeight: '1.1',
      boxShadow: '0 6px 0 rgba(31, 42, 55, 0.25)',
    });
    b.addEventListener('click', () => onPick(kind));
    root.append(b);
  }
  document.body.append(root);

  let shownSelected: PitchKind | null = null;
  let shownEnabled: boolean | null = null;
  let on = false;
  return {
    setShown(v: boolean): void {
      if (v === on) return;
      on = v;
      root.style.display = v ? 'flex' : 'none';
    },
    update(selected: PitchKind, enabled: boolean): void {
      if (selected !== shownSelected) {
        shownSelected = selected;
        for (const kind of KINDS) {
          const b = buttons[kind];
          const sel = kind === selected;
          b.style.background = sel ? ON_BG : OFF_BG;
          b.style.transform = sel ? 'translateY(-4px) scale(1.06)' : 'none';
          b.style.borderColor = sel ? '#0f1722' : INK;
          b.setAttribute('aria-pressed', sel ? 'true' : 'false');
        }
      }
      if (enabled !== shownEnabled) {
        shownEnabled = enabled;
        for (const kind of KINDS) {
          const b = buttons[kind];
          b.disabled = !enabled;
          b.style.opacity = enabled ? '1' : '0.55';
          b.style.cursor = enabled ? 'pointer' : 'default';
        }
      }
    },
    get shown(): boolean {
      return on;
    },
    dispose(): void {
      root.remove();
    },
  };
}
