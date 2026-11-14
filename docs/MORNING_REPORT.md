# Morning report

Kept current through the unattended run that started 2026-11-14. Read this first.

## State of things

- **Milestone 0 (repo setup): done.** The page is still a blank placeholder.
- **Milestone 1 (tech spike): in progress.**
- Nothing has been pushed. Nothing has been deployed.

## How to run

```
pnpm install
pnpm setup:assets     # once: copies MediaPipe WASM, downloads the three models (about 23 MB)
pnpm dev              # http://localhost:5173  and  http://localhost:5173/debug.html
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then `pnpm test:e2e` (Playwright with a fake camera; Chromium lives inside `node_modules`).

## Finished and how it was verified

- **Milestone 0.** Vite 8, TypeScript 6.0.3 strict, ESLint 10, Prettier, Vitest 5, Playwright, GitHub Actions CI (typecheck, lint, test on push), README, `CLAUDE.md`, the brief split into `docs/`, three agent definitions, shared tracking and input contracts. Verified by running typecheck, lint, test, build and the Playwright smoke test locally. The CI workflow has never run because nothing is pushed.

## Parked

Nothing yet.

## Decisions you might disagree with

Full list with reasons in `docs/DECISIONS.md`. The ones most worth a look:

- TypeScript 6.0.x instead of 7.0.2, because the lint toolchain does not support 7 yet (decision 2).
- MediaPipe WASM and models are fetched by `pnpm setup:assets` and gitignored, not committed (decision 4).
- `Claude outputs/` is gitignored and was left untouched (decision 5).
- Continuous signals (hand position, lean, cadence) are state, not events (decision 11).

## Open items using the brief's defaults

- DNS host for `allenzheng.com`: unknown; `docs/DEPLOY.md` will cover both cases. Nothing deployed.
- Licence: none added.
- Global leaderboard: not built; local IndexedDB scores behind a `ScoreStore` interface.

## Blocked by permissions or network

Nothing yet.

## Which model each subagent ran on

The custom agent types in `.claude/agents/` could not be loaded mid-session, so every subagent is a general-purpose agent with the model requested explicitly. The model named below is the one requested; the session cannot independently confirm what actually served it.

| Task | Role | Model requested |
|---|---|---|
| 0.4 Split brief into docs | helper | haiku |
| 0.5 Scaffold | helper | haiku |

## Playtest checklists

Added per milestone as each is completed.
