import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP, SECURITY_HEADERS } from './securityHeaders';

/** Header lines of the first `/*` block of public/_headers. */
function globalBlock(): Map<string, string> {
  const text = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
  const out = new Map<string, string>();
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!raw.startsWith(' ') && !raw.startsWith('\t')) {
      if (inBlock) break;
      inBlock = raw.trim() === '/*';
      continue;
    }
    if (!inBlock) continue;
    const line = raw.trim();
    const colon = line.indexOf(':');
    out.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return out;
}

describe('public/_headers matches the shared security headers', () => {
  const block = globalBlock();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    it(name, () => {
      expect(block.get(name)).toBe(value);
    });
  }

  it('has no extra headers in the global block', () => {
    expect([...block.keys()].sort()).toEqual(Object.keys(SECURITY_HEADERS).sort());
  });

  it('never allows a remote origin or eval', () => {
    expect(CSP).not.toMatch(/https?:/);
    expect(CSP).not.toContain("'unsafe-eval'");
    expect(CSP).toContain("connect-src 'self'");
  });
});
