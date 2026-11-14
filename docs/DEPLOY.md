# Deployment

Target: Cloudflare, at `sports.allenzheng.com`. HTTPS is required for camera access (localhost counts as secure for development). This guide is written for Allen, who runs every step by hand. Nothing in the repo logs in to Cloudflare or deploys on its own.

## What gets deployed

A folder of static files, `dist/`, produced by `pnpm build`. There is no server and no Worker script: Cloudflare serves the files directly ("Workers static assets").

| Part | Size | Notes |
|---|---|---|
| MediaPipe WASM (`wasm/tasks-vision-1.2.3/`) | about 14 MiB each, two `.wasm` files | The name contains the MediaPipe version, so it is cached as immutable |
| Models (`models/*.task`) | 9.0, 7.5 and 5.5 MiB | Pose full, hand, pose lite |
| Game code (`assets/*.js`) | about 5.5 MiB, of which Rapier (bowling only) is 4.1 MiB | Hashed file names |
| Total `dist/` | about 56 MiB, 51 files | Check with `pnpm check:dist` |

Cloudflare allows 25 MiB per file. The largest file is 14 MiB, so there is room. `pnpm check:dist` fails the deploy if any file goes over.

Files that Cloudflare reads from `dist/` but does not serve as pages: `_headers` (headers, see below). Other files in `dist/`: `sw.js` (service worker), `404.html`, `manifest.webmanifest`, `favicon.svg`, `robots.txt`.

## One-time setup

1. Install Node 22 or newer (`node --version`) and pnpm 10 (`pnpm --version`).
2. In the repo folder run `pnpm install`. This also installs `wrangler`, Cloudflare's command-line tool, pinned in `package.json`. If pnpm prints "Ignored build scripts: esbuild, workerd", that is fine: do not approve them, deploys do not need them.
3. Run `pnpm exec wrangler login`. It opens a browser window to log in to the Cloudflare account that should own the site. Only you run this. To check afterwards: `pnpm exec wrangler whoami`.
4. If your Cloudflare account has never used Workers, Cloudflare may ask you to choose a `workers.dev` subdomain on the first deploy (check the current Cloudflare docs for the exact prompt). Pick any name; it only appears in the test URL.

## Every deploy

1. Dry run first: `pnpm deploy:dry`. It does four things, in order:
   - `pnpm setup:assets` copies the MediaPipe WASM from `node_modules` into `public/wasm/` and downloads the three models into `public/models/` if they are not there yet (needs internet the first time only).
   - `pnpm build` type-checks and builds `dist/`.
   - `pnpm check:dist` prints the ten largest files and the total, and fails if any file is over 25 MiB or if the WASM or model files are missing.
   - `wrangler deploy --dry-run` reads `wrangler.jsonc`, reads the files in `dist/` and says what it would upload, without uploading anything. It works without logging in. Expect lines like `Read 51 files from the assets directory` and `--dry-run: exiting now.`
2. Deploy: `pnpm deploy`. It repeats the same steps and then uploads for real. Expect `Uploaded headless-sports`, then `Deployed headless-sports triggers`, then a URL like `https://headless-sports.<your-subdomain>.workers.dev`. The first upload sends every file; later ones send only files that changed, so they are quick. (The wording of wrangler's output changes between versions; the URL is the part to look for.)
3. Smoke-test on the `workers.dev` URL before attaching the real domain, using the checklist below.

### Post-deploy checklist

Do these on the `workers.dev` URL, and again on `https://sports.allenzheng.com` once it is attached.

1. HTTPS padlock: the address bar shows a padlock and the URL starts with `https://`.
2. The camera prompt appears only after you press Start (nothing asks for the camera on the title screen).
3. Open `/debug.html`, allow the camera and check that the skeleton overlay follows you. This proves the WASM and models load under the real headers.
4. Check the headers: open DevTools (F12), Network tab, reload, click the first request (`/` or the document), and look at Response Headers. You should see `content-security-policy: default-src 'self'; ...`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `permissions-policy` and `cross-origin-opener-policy`. The Console must show no "Content Security Policy" errors. Click a file under `/assets/` and check `cache-control: public, max-age=31536000, immutable`.
5. Second load is fast and works offline: reload once (the service worker installs), reload again (Network tab shows files served "from ServiceWorker"), then in DevTools Network set "Offline" and reload: the title screen still opens. Playing needs the camera models, which are cached after the first time you start a sport.

## The custom domain

The aim is `sports.allenzheng.com`. Where the DNS for `allenzheng.com` is hosted is not known, so first find out.

### Which case applies

Run `nslookup -type=NS allenzheng.com` (Windows or macOS terminal). If the answer lists name servers ending in `ns.cloudflare.com` (for example `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`), DNS is on Cloudflare: Case A, provided the zone is in the same Cloudflare account you logged in to (look for `allenzheng.com` in the Cloudflare dashboard under Websites or Domains; check the current Cloudflare docs for the menu name). If you see other names (your registrar, `awsdns`, `googledomains`, `domaincontrol.com` and so on), DNS is elsewhere: Case B. If it is on Cloudflare but under a different account, log in to that account for the deploy, or move the zone.

### Case A: the zone is already on this Cloudflare account

Either:

- Edit `wrangler.jsonc`: remove the comment marks from the `routes` block (and add a comma after the `assets` block), so it reads `"routes": [{ "pattern": "sports.allenzheng.com", "custom_domain": true }]`, then run `pnpm deploy`; or
- In the Cloudflare dashboard open the Worker `headless-sports`, then Settings, then Domains & Routes (check the current Cloudflare docs for the menu names), and add the custom domain `sports.allenzheng.com`.

Cloudflare creates the DNS record and the HTTPS certificate for you. Certificates can take a few minutes to become active. A custom domain on a Worker needs the zone on the same account as the Worker. If a record for `sports` already exists in the zone, Cloudflare asks you to remove or replace it.

### Case B: DNS is hosted elsewhere

There are two honest options.

**B1: move the zone's name servers to Cloudflare (recommended).** This is the supported path for Workers custom domains. It moves all of `allenzheng.com` to Cloudflare, not just the subdomain.

1. In the Cloudflare dashboard add the site `allenzheng.com` (free plan is enough; check the current Cloudflare docs for plan limits). Cloudflare scans for existing DNS records.
2. Compare the imported records with the ones at your current DNS host and add anything missing. Pay special attention to `MX` records (email), `TXT` records (SPF, DKIM, DMARC, site verification), and any `A`/`CNAME` records for the main site. Missing email records can break email delivery.
3. Cloudflare shows two name servers. At the registrar (where you bought the domain), replace the existing name servers with those two.
4. Wait. Propagation can take from minutes to up to a day or so; Cloudflare emails you when the site is active, and `nslookup -type=NS allenzheng.com` shows the Cloudflare names.
5. Continue as Case A.

**B2: keep DNS where it is and use Cloudflare Pages instead of Workers.** Pages accepts a custom domain on a subdomain by pointing a `CNAME` record at the project's `pages.dev` address, so the zone does not have to move. Same `dist/` folder, different command:

```
pnpm setup:assets && pnpm build && pnpm check:dist
pnpm exec wrangler pages deploy dist --project-name headless-sports
```

The first run asks to create the project (production branch name: `main`). The result is `https://headless-sports.pages.dev`. Then in the Pages project open Custom domains, add `sports.allenzheng.com`, and at your DNS host create `CNAME sports -> headless-sports.pages.dev` (check the current Cloudflare docs for the exact hostname it shows). The `_headers` file works the same way on Pages, so the security headers and caching are identical. `404.html` is also served on Pages (Pages serves it automatically for unknown paths).

Trade-off: B2 avoids moving DNS but uses a product Cloudflare is steering new projects away from in favour of Workers (check the current Cloudflare docs for its status), the certificate and DNS validation depend on your DNS host's CNAME handling, and you will have two ways to deploy to keep straight (`wrangler.jsonc` is for Workers and is ignored by `pages deploy`, apart from a warning). B1 is a bigger one-time change but leaves one simple pipeline. Choose B1 unless you have a reason not to touch the zone.

## Headers and CSP

All headers live in `public/_headers` (copied to `dist/_headers`). The security headers are defined once in `src/sw/securityHeaders.ts`; `vite preview` sends the same ones, so the tests in `e2e-deploy/` run under the real policy, and a unit test fails if `_headers` and `securityHeaders.ts` ever differ.

| Header | What it does |
|---|---|
| `Content-Security-Policy` | Tells the browser what the page may load and connect to. The technical backing for "your video never leaves your device" |
| `X-Content-Type-Options: nosniff` | Stops browsers guessing file types |
| `Referrer-Policy: no-referrer` | Never tells other sites where the player came from |
| `Permissions-Policy: camera=(self), microphone=(), geolocation=()` | The camera only for this site; no microphone, no location |
| `Cross-Origin-Opener-Policy: same-origin` | Isolates the page from other windows. No `COEP`: MediaPipe here is single-threaded and does not need `SharedArrayBuffer` |

The policy, directive by directive:

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Everything not listed below comes from our own origin only |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Our scripts only. `'wasm-unsafe-eval'` lets MediaPipe and Rapier compile WebAssembly; it does not allow `eval()`. Nothing more is needed |
| `worker-src` | `'self'` | The tracker worker and the service worker are files on our origin. The starting policy had `blob:`; the tests show no blob worker is created, so it was dropped |
| `connect-src` | `'self'` | The privacy promise: `fetch`, WebSocket and similar can only reach our own origin, so camera data cannot be sent anywhere. The test `the CSP blocks requests to other origins` proves it |
| `img-src` | `'self' data:` | `blob:` dropped (nothing uses it). `data:` kept for tiny inline images |
| `media-src` | `'self'` | `blob:` dropped: the camera stream is attached with `srcObject`, which the CSP does not govern |
| `style-src` | `'self'` | `'unsafe-inline'` dropped: all CSS ships as files and the UI sets styles from script, which is allowed. Consequence: no `<style>` blocks or `style="..."` attributes in markup. `ui-harness.html` (a developer test page, not linked from the game) has an inline `<style>` and so looks unstyled under this policy |
| `font-src` | `'self'` | Fonts are self-hosted |
| `object-src` | `'none'` | No plugins |
| `base-uri` | `'self'` | Blocks injected `<base>` tags |
| `form-action` | `'none'` | The game has no forms that submit |
| `frame-ancestors` | `'none'` | Nobody can embed the game in a frame |

If a future sport needs something looser, loosen only that directive, in `src/sw/securityHeaders.ts` and `public/_headers` together, and say why here.

Caching rules:

| Path | `Cache-Control` | Why |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | Vite puts a content hash in every file name |
| `/wasm/*` | `public, max-age=31536000, immutable` | The MediaPipe version is in the path |
| `/models/*` | `public, max-age=604800` (one week) | The model file names have no version, so they cannot be immutable yet |
| HTML pages, `/` and `/sw.js` | `no-cache` | Always revalidated, so a deploy shows up on the next visit |

To make models immutable later, move them to a versioned folder the same way the WASM is (for example `models/v1/`). Two files change: `scripts/setup-assets.mjs` (where models are downloaded) and `src/tracking/camera/assets.ts` (where they are fetched from). Then add `/models/v1/*` as immutable in `_headers`.

## Service worker and caching

`/sw.js` is a small hand-written worker, built by `vite build`. It is registered only in production builds, only on HTTPS or localhost, and not in automated browsers (unless the URL has `?sw=1`).

- Installed on the first visit: the app shell (`/`, `/index.html` and the hashed JS, CSS and fonts the title screen needs: 15 files, about 1.2 MiB).
- Cached on first use: each sport's code chunk and the WASM (cache-first, they never change under the same name), and the models (served from cache and refreshed in the background).
- Never cached: other origins, non-GET requests, range requests, and any response that is not a plain 200.
- Opening the game: the network is tried first (up to 3 seconds), then the cached shell. After one visit the game opens offline.
- Updates: after a deploy, the new worker installs in the background and waits. The running game is never swapped mid-round. The new version loads the next time the game is opened. The page records this as `window.__sw.waiting` and logs one line to the console. The code and shell caches of the old version are deleted when the new worker activates; the WASM and model cache (`hs-big-v1`) is kept so players do not download them again.
- Force a clean slate: open the site with `?sw=0` (for example `https://sports.allenzheng.com/?sw=0`). That unregisters the worker and deletes its caches; then load the normal URL again. Use this if a bad deploy seems stuck.
- Models are not `immutable` yet because their file names carry no version; the worker's background refresh and the one-week `max-age` keep them current without that.

## Rollback and taking the site down

- Roll back to the previous version: `pnpm exec wrangler rollback` lists recent versions and asks which to restore. The Cloudflare dashboard (the Worker's Deployments tab) can do the same. Check the current Cloudflare docs for how many versions are kept.
- Or redeploy an older commit: `git checkout <commit>`, then `pnpm deploy`, then return to your branch (`git checkout -`).
- Players with the previous version cached see the rolled-back version on the visit after next; `?sw=0` forces it at once.
- Take the site down: delete the Worker in the dashboard (Settings, Delete) or run `pnpm exec wrangler delete`. For Pages (case B2) delete the Pages project. If you attached a custom domain, also remove the domain or the DNS record so it does not point at nothing.

## Later: the global leaderboard

Not built. Scores are stored on the player's device today. A global leaderboard would add a small Worker with a D1 (SQLite) database, reachable at a path on the same origin (for example `/api/scores`), so `connect-src 'self'` still holds and nothing about the privacy promise changes: only a name and a score would be sent, never video. In `wrangler.jsonc` it would mean adding a `main` script and a `d1_databases` binding next to the `assets` block, with the Worker handling `/api/*` and everything else served from the static assets. That work is a separate task and would need its own review of what is sent.
