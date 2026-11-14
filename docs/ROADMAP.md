# Roadmap

Status of every milestone and task. A fresh session resumes from here: find the first task that is not `done`, read its notes, and continue. Update this file and `docs/MORNING_REPORT.md` after every accepted task.

Status values: `todo`, `doing`, `done`, `parked` (failed three real attempts; see the morning report).

Agents: **B** builder (sonnet), **H** helper (haiku), **R** reviewer (opus), **O** orchestrator (main session).

## Milestone 0: repo setup

| Task | Agent | Status | Notes |
|---|---|---|---|
| 0.1 Environment check | O | done | Node 22.13.1, pnpm 10.34.6, git 2.48.1, Windows PowerShell 5.1 |
| 0.2 Subagent definitions in `.claude/agents/` | O | done | Not loadable until restart; see decision 6 |
| 0.3 `CLAUDE.md`, `ROADMAP.md`, `DECISIONS.md`, `MORNING_REPORT.md` | O | done | |
| 0.4 Split brief into `docs/` | H | done | ARCHITECTURE, TRACKING, DESIGN, SPORTS, DEPLOY (stub) |
| 0.5 Scaffold: Vite, TS strict, ESLint, Prettier, Vitest, Playwright, CI, README, asset script | H | done | typecheck, lint, test, build and the e2e smoke test pass |
| 0.6 Shared contracts: `src/tracking/types.ts`, `src/input/types.ts` | O | done | |
| 0.7 First commit | O | done | |

## Milestone 1: tech spike

Contracts first (0.6), then three builders in parallel on disjoint directories, then integration.

| Task | Agent | Status | Files | Notes |
|---|---|---|---|---|
| 1.1 Camera source, tracking worker, Pose lite, wrist crops, Hand Landmarker, main-thread fallback | B | done | `src/tracking/camera/**` | Parallel group A |
| 1.2 One Euro filter, least-squares velocity, fist classifier, pose kinematics | B | done | `src/input/filters/**`, `src/input/kinematics/**`, `src/input/hands/**` | Parallel group A |
| 1.3 Synthetic player (body model, script DSL), replayer, recorder | B | done | `src/tracking/synthetic/**`, `src/tracking/replay/**` | Parallel group A |
| 1.4 Renderer factory (WebGPU / WebGL switch), Field Day style kit basics, procedural athlete with two-bone IK | B | done | `src/render/**` | Parallel group A |
| 1.5 Debug page: camera feed, skeleton overlay, hand crops, fist state, HUD (inference ms, tracking Hz, render fps, latency), athlete mirroring the upper body, record / replay controls | B | done | `src/debug/**` | After group A |
| 1.6 Gate benchmark, first draft | B | doing | `src/core/gate/**` | With 1.5 |
| 1.7 Playwright harness: fake camera pipeline check, synthetic source check, screenshots | B | done | `e2e/**` | After 1.5 |
| 1.8 Review of milestone 1 | R | todo | | |

## Milestone 2: foundation

| Task | Agent | Status | Notes |
|---|---|---|---|
| 2.1 Contracts: `src/core/sport.ts`, event types | O | done | |
| 2.2 Recognizer library (fist, arm raised, knee-lift cadence, throw, swing, punch, lean, squat, jump) with synthetic-sequence tests | B | doing | |
| 2.3 `TrackedInput` and `DebugInput` providers, event bus | B | doing | |
| 2.4 Game loop (fixed 120 Hz step, render interpolation), sport loader, tunables registry and panel | B | todo | |
| 2.5 Avatar clips (run cycle, follow-through, celebration, climbing sway), mitt curl, blob shadows, style kit completion | B | doing | |
| 2.6 UI shell: title, sport menu, hand cursor with hold-to-select, HUD kit, mirror view, fonts, audio chimes | B | doing | |
| 2.7 Onboarding and calibration, out-of-frame pause, camera permission flow, safety reminder | B | doing | |
| 2.8 Gate screen wired to the benchmark | B | todo | |
| 2.9 Scores: `ScoreStore` interface, IndexedDB implementation | B | done | |
| 2.10 Service worker caching | B | todo | |
| 2.11 Review of milestone 2 | R | todo | |

## Milestones 3 to 7: sports

Each sport: module under `src/sports/<name>/`, typed tunables, synthetic script, debug-input mapping, unit tests for physics and scoring, Playwright round under the synthetic player, screenshot check against the Field Day theme, playtest checklist.

| Milestone | Sport | Agent | Status | Notes |
|---|---|---|---|---|
| 3 | Rock climbing | B | todo | |
| 4 | Bowling | B | todo | Rapier, lazy-loaded |
| 5 | Baseball batting | B | todo | Can run in parallel with 4 in a worktree |
| 6 | Archery | B | todo | |
| 7 | Javelin | B | todo | Can run in parallel with 6 in a worktree |

## Milestone 8: launch polish

| Task | Agent | Status | Notes |
|---|---|---|---|
| 8.1 Accessibility pass and seated modes | B | todo | |
| 8.2 Deployment config (`wrangler`, `_headers`, CSP) and full `docs/DEPLOY.md` | B / H | todo | Deploy nothing |
| 8.3 Memory soak test under the synthetic player | B | todo | |

## If everything above is done

In this order: whole-codebase reviewer pass against the performance rules, then fixes; more test coverage for recognizers, physics and scoring; baseball pitching (reuses the javelin throw recognizer); finalise the morning report.

## Later, not scheduled

- Global leaderboard on a Cloudflare Worker with D1 (plausibility caps, rate limiting, server-side score recompute).
- LiteRT.js as a tracker backend if MediaPipe's WebGL path becomes the bottleneck.
- Pose lite versus Pose full and WebGPU versus WebGL renderer: both wait for measurements on the owner's hardware.
- Backlog sports in `docs/SPORTS.md`.
