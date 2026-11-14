import type { SportMeta } from '../core/sport';

/** '12.4 m', '30 pts'. */
export function formatScore(meta: SportMeta, value: number): string {
  const text = value.toFixed(meta.score.decimals);
  return meta.score.unit ? `${text} ${meta.score.unit}` : text;
}

/** '#rrggbb' from a hex number. */
export function hexColor(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Pre-built strings so per-frame DOM writes never build new ones. */
export const PCT_INT: readonly string[] = Array.from({ length: 101 }, (_, i) => `${i}%`);
export const PCT_TENTH: readonly string[] = Array.from(
  { length: 1001 },
  (_, i) => `${(i / 10).toString()}%`,
);

/** Normalised 0..1 to a CSS percentage string at 0.1% resolution. */
export function pctTenth(v: number): string {
  const i = Math.round(v * 1000);
  return PCT_TENTH[i < 0 ? 0 : i > 1000 ? 1000 : i] as string;
}

export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export function detectBrowser(ua: string): BrowserName {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
