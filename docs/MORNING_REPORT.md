# Morning report

Kept current through the unattended run that started 2026-11-14. Read this first.

## State of things

- **Milestone 0 (repo setup): done**, merged to `main`.
- **Milestone 1 (tech spike): built and passing headless**, on branch `m1-tech-spike`. Not yet verified with a real camera or a real GPU. Reviewer pass in progress.
- **Milestone 2 (foundation): in progress.** Done: recognizers, `TrackedInput`, `DebugInput`, scores, calibration logic, avatar animator, device gate, closed-loop synthetic player. In progress: the DOM interface and the game shell.
- **Sports: none yet.**
- Nothing has been pushed. Nothing has been deployed.

**The single most important thing to check first** is the tracking debug page with your real camera (checklist below). Everything else is built on the assumption that it works.

## How to run

```
pnpm install
pnpm setup:assets     # once: copies MediaPipe WASM, downloads the three models (about 23 MB)
pnpm dev              # http://localhost:5173
```

- Tracking debug page: `http://localhost:5173/debug.html`
- Without a camera: `debug.html?source=synthetic&script=wave` (other scripts: `idle`, `fists`, `bowl`, `throw`, `swing`, `run`, `hands`, `lost`, `all`)
- Flags: `?renderer=webgl`, `?pose=full`, `?main=1` (main-thread tracking), `?skipGate=1`, `?input=debug`, `?timeScale=4` (synthetic and replay only), `?debug=1` (tunables panel)

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then `pnpm test:e2e` (Playwright with a fake camera; Chromium lives inside `node_modules`). Two extra Playwright suites have their own configs: `pnpm exec playwright test --config playwright.gate.config.ts` and `--config playwright.ui.config.ts` (each needs its own build first: `pnpm exec vite build --outDir dist-gate` / `dist-ui`).

## Finished and how it was verified

- **Milestone 0.** Vite 8, TypeScript 6.0.3 strict, ESLint 10, Prettier, Vitest 5, Playwright, GitHub Actions CI (typecheck, lint, test on push), README, `CLAUDE.md`, the brief split into `docs/`, three agent definitions, shared contracts. Verified by running the checks locally. The CI workflow has never run because nothing is pushed.
- **1.1 Camera tracking** (`src/tracking/camera/`). Webcam to module worker to Pose Landmarker and Hand Landmarker (wrist crops and full-frame), mirrored once, packed transferable buffers recycled between threads, GPU delegate with CPU fallback, main-thread fallback, camera-clock timestamps. Verified: unit tests for crop maths, packing and hand-slot assignment; Playwright with the fake camera confirms all four modes (pose, crops, full-frame hands, main-thread) start and deliver frames with no errors. **Not verified:** any detection of a real person or hand (the fake feed has none), real-GPU speed.
- **1.2 Input primitives** (`src/input/`). One Euro filters, least-squares velocities normalised by shoulder width, fist classifier with hysteresis, pose kinematics, `FrameProcessor`. Unit-tested.
- **1.3 Synthetic player, replayer, recorder** (`src/tracking/synthetic/`, `src/tracking/replay/`). A 2D body and hand model driven by scripts or a live move queue at 30 Hz with seeded noise; record and replay JSON clips. Unit-tested, deterministic.
- **1.4 Rendering** (`src/render/`). Renderer factory with the WebGPU / WebGL2 switch, Field Day scene, toon materials, blob shadows, the headless athlete (14 meshes, two materials) with two-bone IK and pose mirroring. Unit-tested; looked at in headless screenshots (see "Things I noticed").
- **1.5 / 1.7 Debug page and Playwright harness.** Camera or synthetic feed with skeleton overlay, hand crops, fist state, kinematics readout, HUD (inference ms, tracking Hz, render fps, estimated latency, dropped frames, delegate, backend, draw calls), record / replay controls. Six Playwright checks pass, including "the avatar's right mitt rises when the synthetic player raises their right arm" and record-then-replay.
- **1.6 / 2.8 Device gate** (`src/core/gate/`). Capability checks, then pose inference on a synthetic frame concurrently with a representative render load. Playwright confirms it runs, cleans up, and (correctly) fails headless software rendering.
- **2.2 / 2.3 Recognizers and providers.** Arm raise, knee-lift cadence, throw (underarm and overarm, release stamped at the wrist-speed peak), two-handed swing, punch, squat, jump; `TrackedInput`; `DebugInput` (keyboard and mouse). 220 unit and integration tests against the synthetic player across five noise seeds. **All recognizer thresholds are tuned to synthetic motion and are placeholders.**
- **2.7 (logic) Calibration session, 2.9 Scores, avatar animator, move queue.** Unit-tested.

## Parked

Nothing.

## Things I noticed that need your eyes

- In the headless screenshot the athlete's feet are hidden behind the shins from the default camera, so the coral feet are not visible from behind. Cosmetic; will be adjusted if time allows.
- The synthetic bowling swing is a simplified diagonal sweep. A real underarm swing seen from the front reverses direction at the bottom, which the throw recognizer has not seen yet. Record real clips early (checklist below).
- The throw recognizer suspends itself when the shoulders move faster than 3 sw/s, to stop sidesteps looking like throws. A real javelin run-up may trip this (`recognizerConfig.throw.maxBodySpeed`).
- A fast arm raise can register as a throw. Sports ignore throws outside their throwing phase.

## Decisions you might disagree with

Full list with reasons in `docs/DECISIONS.md`. The ones most worth a look:

- TypeScript 6.0.x instead of 7.0.2, because the lint toolchain does not support 7 yet (decision 2).
- MediaPipe WASM and models are fetched by `pnpm setup:assets` and gitignored, not committed (decision 4).
- `Claude outputs/` is gitignored and was left untouched (decision 5).
- Continuous signals (hand position, lean, cadence) are state, not events (decision 11).
- `?renderer=webgl` uses `WebGPURenderer`'s WebGL2 backend, not the legacy `WebGLRenderer` (decision 13).
- Headless rounds are played by a per-sport bot that reacts to game state, not by fixed scripts (decision 15).

## Open items using the brief's defaults

- DNS host for `allenzheng.com`: unknown; `docs/DEPLOY.md` will cover both cases. Nothing deployed.
- Licence: none added.
- Global leaderboard: not built; local IndexedDB scores behind a `ScoreStore` interface.

## Blocked by permissions or network

Nothing so far.

## Which model each subagent ran on

The custom agent types in `.claude/agents/` could not be loaded mid-session, so every subagent is a general-purpose agent with the model requested explicitly. The model named below is the one requested; the session cannot independently confirm what actually served it.

| Task | Role | Model requested |
|---|---|---|
| 0.4 Split brief into docs | helper | haiku |
| 0.5 Scaffold | helper | haiku |
| 1.1 Camera tracking | builder | sonnet |
| 1.2 Input primitives | builder | sonnet |
| 1.3 Synthetic player, replay, recorder | builder | sonnet |
| 1.4 Renderer, style kit, athlete | builder | sonnet |
| 1.5 / 1.7 Debug page and e2e | builder | sonnet |
| 1.6 / 2.8 Device gate | builder | sonnet |
| 1.8 Review of milestone 1 | reviewer | opus |
| 2.2 / 2.3a Recognizers, TrackedInput | builder | sonnet |
| 2.3b DebugInput | builder | sonnet |
| 2.4 Game shell | builder | sonnet |
| 2.5 / 2.7 Animator, calibration, move queue | builder | sonnet |
| 2.6 UI kit | builder | sonnet |
| 2.9 Score store | helper | haiku |

## Playtest checklists

### Milestone 1: tracking (do this first)

Open `http://localhost:5173/debug.html` in Chrome or Edge, allow the camera, stand about 2 to 2.5 m back so your whole body is in view.

1. **Does it start?** You should see yourself mirrored with a green skeleton on top within a few seconds. If you get an error message instead, note its text.
2. **Numbers to write down** from the Performance card, standing still, with "Pose + hand crops" selected: inference ms, tracking Hz, render fps, latency (est.), dropped frames, tracker delegate (GPU or CPU), tracking thread (worker or main), renderer (webgpu or webgl2). Then again with:
   - "Pose" only, and "Full-frame hands" (sit close for this one).
   - `?renderer=webgl` (button "WebGL renderer"). This is the WebGPU versus WebGL decision: which gives the higher tracking Hz and render fps together?
   - `?pose=full` (button "Full pose model"). This is the lite versus full decision: is full still at or near 30 Hz, and is the skeleton visibly steadier?
   - Target: tracking at or near 30 Hz, render at or near your display rate, latency under about 130 ms.
3. **Mirroring.** Raise your right hand. The skeleton's raised arm and the athlete's raised mitt should both be on the right side of the screen.
4. **Athlete.** Move both arms around slowly, then quickly. The athlete's arms should follow without obvious jitter when you hold still and without obvious lag when you move. Reach toward the camera: the athlete's arm should reach forward (away from you, into the scene).
5. **Fists at distance.** With "Pose + hand crops", hold each hand still, roughly at chest height, and close and open it. Watch "Fist closed" and "Curl" in the Input state card, the two crop thumbnails, and the ring on the palm (coral when closed). Note: does the crop contain your hand? What are the curl values open and closed (thresholds are closed below 0.9, open above 1.3)? How far back can you stand before it stops working?
6. **Fists up close.** Select "Full-frame hands", sit about 1 m away, show both hands. Same observations. Cross your hands: do left and right stay attached to the correct hands?
7. **Out of frame.** Walk out of view and back. "Tracking" should go to no, "Problem" to lost, then recover.
8. **Record clips** (button "Record", then stop; a JSON file downloads). Save each into `tests/recordings/` with these names. They replace the synthetic placeholders in the recognizer tests:
   - `fist-close-open-right.json`, `fist-close-open-left.json` (pose + hand crops, standing, hand still)
   - `bowl-right-slow.json`, `bowl-right-fast.json`, `bowl-right-curve.json` (underarm swing as if bowling, facing the camera)
   - `throw-overarm-right-soft.json`, `throw-overarm-right-hard.json`
   - `swing-two-hand.json` (three batting swings with pauses)
   - `run-in-place-slow.json`, `run-in-place-fast.json` (ten seconds each)
   - `arm-raise-fist.json` (raise a fist above your head, hold, lower; three times)
   - `idle-fidget.json` (thirty seconds of standing, shifting weight, scratching your nose: the false-positive test)
   - `squat-jump.json`
   - `climb-hands.json` (full-frame hands, close: reach up, close, pull down, alternate hands, ten times)
   - `draw-bow.json` (bow arm out, draw hand closes near it, pulls back to the cheek, holds, opens)
   Play any clip back with the source picker on the debug page to see what the game saw.
9. **Gate.** Open `http://localhost:5173/tracking-harness.html?mode=gate`. Write down the whole report (inference ms, tracking Hz, render fps, passed or failed). Thresholds are tracking 25 Hz and render 50 fps.

Checklists for milestone 2 and each sport are added as they are completed.
