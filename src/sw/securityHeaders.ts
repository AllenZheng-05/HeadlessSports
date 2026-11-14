/**
 * The single source of truth for the security headers. `vite.config.ts` sends these from
 * `vite preview` so the e2e-deploy suite exercises the real policy, and `securityHeaders.test.ts`
 * asserts that `public/_headers` (what Cloudflare serves) carries exactly the same values.
 * Change a value here and in `public/_headers` together; the test fails if they drift.
 */

/** Directive order matches public/_headers. Justifications are in that file and docs/DEPLOY.md. */
export const CSP_DIRECTIVES: readonly (readonly [string, string])[] = [
  ['default-src', "'self'"],
  ['script-src', "'self' 'wasm-unsafe-eval'"],
  ['worker-src', "'self'"],
  ['connect-src', "'self'"],
  ['img-src', "'self' data:"],
  ['media-src', "'self'"],
  ['style-src', "'self'"],
  ['font-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"],
];

export const CSP = CSP_DIRECTIVES.map(([name, value]) => `${name} ${value}`).join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
