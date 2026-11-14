/**
 * The catcher's speech bubble: a DOM element laid over the canvas and moved above the catcher each
 * frame. Styling is set through the CSS object model (the page's CSP forbids inline style markup
 * and the pitching module may not touch src/ui). Large type, so it reads from 2 m away.
 */
export type BubbleTone = 'call' | 'good' | 'bad';

const TONE_BG: Record<BubbleTone, string> = {
  call: '#ffffff',
  good: '#d8f5c9',
  bad: '#ffd9cf',
};

export interface Bubble {
  /** Set the big line and the small line under it. Only touches the DOM when they change. */
  setText(main: string, sub: string, tone: BubbleTone): void;
  /** Show or hide. */
  setVisible(on: boolean): void;
  /** Screen position of the tail tip, in CSS pixels. */
  place(x: number, y: number): void;
  readonly visible: boolean;
  dispose(): void;
}

export function createBubble(): Bubble {
  const root = document.createElement('div');
  root.dataset['testid'] = 'catcher-bubble';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  Object.assign(root.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    zIndex: '12',
    pointerEvents: 'none',
    display: 'none',
    boxSizing: 'border-box',
    maxWidth: '82vw',
    padding: '14px 26px 16px',
    border: '5px solid #1f2a37',
    borderRadius: '28px',
    background: TONE_BG.call,
    color: '#1f2a37',
    textAlign: 'center',
    fontFamily: "'Fredoka', system-ui, sans-serif",
    boxShadow: '0 6px 0 rgba(31, 42, 55, 0.25)',
    willChange: 'transform',
  });
  const main = document.createElement('div');
  Object.assign(main.style, {
    fontSize: 'clamp(30px, 5.4vh, 56px)',
    fontWeight: '700',
    lineHeight: '1.1',
    whiteSpace: 'nowrap',
  });
  const sub = document.createElement('div');
  Object.assign(sub.style, {
    fontSize: 'clamp(18px, 2.8vh, 28px)',
    fontWeight: '600',
    lineHeight: '1.2',
    marginTop: '4px',
    opacity: '0.8',
  });
  const tail = document.createElement('div');
  Object.assign(tail.style, {
    position: 'absolute',
    left: '50%',
    bottom: '-17px',
    width: '24px',
    height: '24px',
    marginLeft: '-12px',
    background: 'inherit',
    borderRight: '5px solid #1f2a37',
    borderBottom: '5px solid #1f2a37',
    transform: 'rotate(45deg)',
  });
  root.append(main, sub, tail);
  document.body.append(root);

  let shownMain = '';
  let shownSub = '';
  let shownTone: BubbleTone = 'call';
  let on = false;
  let lastX = -1;
  let lastY = -1;
  return {
    setText(m: string, s: string, tone: BubbleTone): void {
      if (m !== shownMain) {
        shownMain = m;
        main.textContent = m;
      }
      if (s !== shownSub) {
        shownSub = s;
        sub.textContent = s;
        sub.style.display = s === '' ? 'none' : 'block';
      }
      if (tone !== shownTone) {
        shownTone = tone;
        root.style.background = TONE_BG[tone];
      }
    },
    setVisible(v: boolean): void {
      if (v === on) return;
      on = v;
      root.style.display = v ? 'block' : 'none';
    },
    place(x: number, y: number): void {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px === lastX && py === lastY) return;
      lastX = px;
      lastY = py;
      // Centred on x, with the bottom edge 22 px above the tail tip.
      root.style.transform = `translate(${px}px, ${py}px) translate(-50%, calc(-100% - 22px))`;
    },
    get visible(): boolean {
      return on;
    },
    dispose(): void {
      root.remove();
    },
  };
}
