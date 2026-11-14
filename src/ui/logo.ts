import { svgEl } from './dom';

/** The headless athlete with one fist raised. Inline SVG so it needs no asset. */
export function createLogo(size = 200): SVGSVGElement {
  const INK = '#27364a';
  const PUTTY = '#f4f1ea';
  const WHISTLE = '#ff7a59';
  const svg = svgEl('svg', {
    viewBox: '0 0 200 240',
    width: size,
    height: Math.round(size * 1.2),
    role: 'img',
    'aria-label': 'A headless athlete with one fist raised',
  });
  svg.setAttribute('class', 'logo');

  const limb = (x1: number, y1: number, x2: number, y2: number): void => {
    svg.append(
      svgEl('line', {
        x1,
        y1,
        x2,
        y2,
        stroke: INK,
        'stroke-width': 26,
        'stroke-linecap': 'round',
      }),
      svgEl('line', {
        x1,
        y1,
        x2,
        y2,
        stroke: PUTTY,
        'stroke-width': 19,
        'stroke-linecap': 'round',
      }),
    );
  };
  const ball = (cx: number, cy: number, r: number): void => {
    svg.append(
      svgEl('circle', { cx, cy, r, fill: WHISTLE, stroke: INK, 'stroke-width': 6 }),
      svgEl('path', {
        d: `M ${cx - r * 0.45} ${cy - r * 0.35} q ${r * 0.25} ${-r * 0.35} ${r * 0.6} ${-r * 0.2}`,
        stroke: '#ffd2c4',
        'stroke-width': 4,
        'stroke-linecap': 'round',
        fill: 'none',
      }),
    );
  };

  // legs
  limb(86, 150, 78, 204);
  limb(114, 150, 122, 204);
  // arms: left relaxed, right straight up
  limb(74, 92, 42, 138);
  limb(128, 90, 142, 42);
  // torso with a neck opening on top
  svg.append(
    svgEl('rect', {
      x: 66,
      y: 66,
      width: 68,
      height: 92,
      rx: 32,
      fill: PUTTY,
      stroke: INK,
      'stroke-width': 6,
    }),
    svgEl('ellipse', {
      cx: 100,
      cy: 74,
      rx: 18,
      ry: 7,
      fill: '#d8d2c4',
      stroke: INK,
      'stroke-width': 4,
    }),
  );
  // feet
  for (const cx of [72, 128]) {
    svg.append(
      svgEl('ellipse', {
        cx,
        cy: 214,
        rx: 20,
        ry: 11,
        fill: WHISTLE,
        stroke: INK,
        'stroke-width': 6,
      }),
    );
  }
  // mitts: relaxed left hand, raised fist
  ball(38, 146, 13);
  ball(145, 26, 19);
  return svg;
}
