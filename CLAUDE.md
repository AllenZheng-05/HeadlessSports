# Headless Sports

A Wii Sports-style collection of sports mini-games that runs entirely in the browser with no controller. The player stands in front of a webcam; MediaPipe tracks body and hands on-device; movements drive a low-poly **headless** athlete (torso, arms, legs, mitts, feet, no head). Static site, desktop only, target `headlesssports.allenzheng.com`. Owner: Allen.

The repo is the source of truth. Start with `docs/ROADMAP.md` (status and next task) and `docs/MORNING_REPORT.md` (state of the build, how to run it, playtest checklists).

## Commands

```
pnpm install          # dependencies
pnpm setup:assets     # copy MediaPipe WASM to public/wasm, download models to public/models (both gitignored)
pnpm dev              # http://localhost:5173  (game: /, debug page: /debug.html)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint + prettier --check   (pnpm format to fix formatting)
pnpm test             # vitest (unit)
pnpm build            # typecheck + vite build
pnpm test:e2e         # Playwright, fake camera, against `pnpm preview` (run pnpm build first)
```

`pnpm typecheck`, `pnpm lint` and `pnpm test` must pass before any commit. A milestone is done only when those plus `pnpm build` and `pnpm test:e2e` pass. Never weaken or delete a test to get there.

Query flags: `?input=debug` (camera off, play with the mouse only), `?source=synthetic&script=<name>` / `?source=replay&clip=<name>` (landmark source), `?renderer=webgl`, `?pose=full`, `?skipGate=1`, `?timeScale=<n>` (synthetic and replay only), `?debug=1` (tunables panel), `?hand=left|right` (default dominant hand for mouse play), `?tutorial=1` (with `?sport=`, start that sport in tutorial mode), `?players=2..4` with `?sport=` (start a pass-and-play game with default names, or `?names=Mia,Sam`).

## Hard constraints

- Browser only, static site, no game server. Camera video never leaves the device. No runtime CDN: WASM, models and fonts are self-hosted.
- Desktop and laptop only. No mobile layouts, touch controls or low-power fallbacks. One fixed quality configuration; weak devices get a warning and may continue, not degraded quality.
- Adding a sport means adding a module under `src/sports/<name>/` that reuses shared tracking, recognizers, avatar and UI. Sports never read raw landmarks for gesture logic; they consume `InputProvider` state and events.
- Stack is fixed (see `docs/ARCHITECTURE.md`): TypeScript strict, Vite, pnpm, Vitest, three.js from `three/webgpu`, `@mediapipe/tasks-vision`, Rapier for bowling pins only, plain DOM UI. All versions pinned exactly.

## The kinematics rule

**Fast actions are detected from arm kinematics; hand state is only used for slow, deliberate moments.** A fist or open hand is a grab, hold or confirm made while roughly still. Throw releases, swings and punches come from wrist speed, elbow extension and trajectory shape, as state machines over 150 to 400 ms, with the release timestamped at the speed peak. Never score on world-z; depth is a coarse hint only. Details in `docs/TRACKING.md`.

## Performance rules (requirements, not polish)

1. Inference runs in a dedicated worker; frames are transferred, never copied.
2. Inference at camera rate (30 Hz); render at display rate, interpolating the avatar between the two latest filtered poses.
3. **No allocation per frame** in the game loop or the landmark path: pre-allocate vectors, matrices and typed arrays; no per-frame closures, array literals, object literals, `map`/`filter`/spread, or string building. Allocating when a discrete event fires is fine.
4. Timestamps come from the camera clock (`requestVideoFrameCallback` metadata), never `performance.now()` at inference time. Filters and recognizers use frame timestamps.
5. Only the trackers the current sport needs are loaded; hand crops only in phases that need them.
6. Under about 100 draw calls: instancing for repeated props, merged static geometry.
7. No post-processing, no shadow maps (blob shadows), device pixel ratio capped at 1.5.
8. `MeshToonMaterial`, flat vertex colours, no textures unless a sport truly needs one.
9. Fixed-timestep physics at 120 Hz, decoupled from rendering. Physics and scoring functions are pure and deterministic.
10. Every sport keeps its thresholds, timings and scoring constants in one typed config object registered with the tunables panel.

## Conventions

- Coordinates: landmark x/y are normalised image coordinates **already mirrored** (x grows toward screen right as the player sees themselves in a mirror; y grows downward). Landmark indices keep MediaPipe's anatomical meaning, so the player's left wrist appears on screen left. The avatar is viewed from behind, so its left is screen left too. World space is three.js default: +y up, the athlete faces -z (into the screen), metres.
- Time: every timestamp is "game ms". With the camera source this is the `performance.now()` timeline, taken from the camera clock. Synthetic and replay sources are stepped by the game clock so `?timeScale` works.
- Shared contracts live in `src/tracking/types.ts`, `src/input/types.ts` and `src/core/sport.ts`. Change them only by agreement with the orchestrator.
- Tests sit next to the code as `*.test.ts`. Recorded landmark clips live in `tests/recordings/`.
- Workers must not import DOM-only modules. `tsconfig` uses the DOM lib only; inside worker files cast `self` to a small local interface instead of adding the `webworker` lib.
- Copy tone: short, friendly, plain, sentence case.

## How work is organised

The main session orchestrates: it plans, writes briefs, reviews and integrates. It does not write feature code. Subagents do the coding:

| Role | Model | Does |
|---|---|---|
| `builder` | sonnet | Feature code from a written brief |
| `helper` | haiku | Mechanical work: scaffolding, config, docs, simple tests, searches |
| `reviewer` | opus | Read-only review against the brief; never edits |

Rules: every task gets a written brief (goal, files to read, files owned, interfaces as TypeScript signatures, acceptance checks, out of scope, report format). Parallelise only across disjoint files. Review before accepting. One logical commit per accepted task; feature branches merged into `main` after milestone 0. **Do not push** unless Allen says so. No co-author trailers on commits. After every accepted task update `docs/ROADMAP.md` and `docs/MORNING_REPORT.md`. Record engineering decisions with reasons in `docs/DECISIONS.md`.

## Docs

- `docs/ARCHITECTURE.md` stack, architecture, performance requirements, device gate, verification standards
- `docs/TRACKING.md` tracking pipeline, signal handling, recognizers, testing without a webcam
- `docs/DESIGN.md` the Field Day theme, onboarding, privacy, safety, accessibility
- `docs/SPORTS.md` sport designs, build order, backlog, poor fits
- `docs/ROADMAP.md` milestones and task status
- `docs/DECISIONS.md` decisions and reasons
- `docs/DEPLOY.md` deployment steps
- `docs/MORNING_REPORT.md` current state, how to run, playtest checklists
