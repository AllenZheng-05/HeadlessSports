/** Small DOM helpers shared by every part of the interface. */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A real button that the hand cursor, mouse and keyboard can all operate. */
export function selectButton(label: string, className = 'btn'): HTMLButtonElement {
  const b = h('button', className, label);
  b.type = 'button';
  b.setAttribute('data-select', '');
  return b;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  if (tag === 'svg') {
    // Fixed pixel sizes scale with the interface (--u, see ui.css).
    const w = attrs.width;
    const hh = attrs.height;
    if (typeof w === 'number') node.style.width = `calc(${w} * var(--u))`;
    if (typeof hh === 'number') node.style.height = `calc(${hh} * var(--u))`;
  }
  return node;
}

/** The interface scale for the current window. Mirrors `--u` in ui.css (1 at 1280x720). */
export function uiScale(): number {
  if (typeof window === 'undefined') return 1;
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  return s < 1 || !(s > 0) ? 1 : s > 2.25 ? 2.25 : s;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
