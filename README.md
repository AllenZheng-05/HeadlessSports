# Headless Sports

Wii-Sports-style browser mini-games controlled by webcam body tracking. You play as a headless athlete: your body movements, read from the webcam through MediaPipe pose and hand tracking, drive the game. Everything runs on-device; no video leaves the browser.

## Prerequisites

- Node 22+
- pnpm, enabled via corepack (`corepack enable`)

## Commands

```sh
pnpm install          # install dependencies
pnpm setup:assets     # copy MediaPipe WASM and download model files into public/
pnpm dev              # start the Vite dev server (port 5173)
pnpm build            # typecheck and produce a production build
pnpm test             # run unit tests (Vitest)
pnpm test:e2e         # run browser tests (Playwright)
pnpm lint             # ESLint and Prettier checks
pnpm typecheck        # TypeScript type check
```

See `docs/` and `CLAUDE.md` for design notes and conventions.
