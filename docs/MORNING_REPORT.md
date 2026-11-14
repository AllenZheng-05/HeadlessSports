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

### Milestone 3: rock climbing

Open `http://localhost:5173/`, pick Rock climbing. Sit or stand about 1 m from the camera with both hands in view. Without a camera: `/?sport=climbing&input=debug&skipGate=1` (A / D select a hand, mouse moves it, Q / E toggle fists) or watch the bot at `/?sport=climbing&source=synthetic&skipGate=1`. Add `&debug=1` for the tunables panel.

1. **Grab.** Hold a hand over a hold: it should brighten and grow slightly. Close the hand: the mitt snaps on and a sound plays. Note whether grabs register reliably. Tunables: `grabWindowMs` 250, `jugRadius` 0.17, `crimpRadius` 0.10.
2. **Pull.** Pull the closed hand down: the climber rises about 1.5 m per full image height. Does tracker jitter shake the body? Tunables: `reachWidth`, `reachHeight`, `reachOffsetY`, `followRate`, `maxClimbSpeed`.
3. **Alternate hands for a minute.** Count unintended drops (the fist flickered or the hand was lost for a moment). Tunables: `lostHandGraceMs` 500, `slipGraceMs` 350, and the fist thresholds in the input config.
4. **Stamina and ledges.** Can you reach the first rest ledge at 20 m? I lowered the drain rates (two hands 0.02/s, one hand 0.035/s) after the bot ran out near 11 m; judge whether it is now too easy. Tunables: `drainTwoHands`, `drainOneHand`, `ledgeEveryM`.
5. **Comfort.** Is the top of the reach comfortable, and do your hands stay in frame? Does a 75 second round tire your arms too much?
6. Known cosmetic issues: a hand held below shoulder height can hide behind the torso; the putty body picks up a slight green tint from the scene lighting.

### Milestone 4: bowling

Pick Bowling; stand about 2 to 2.5 m back, whole body in view. Without a camera: `/?sport=bowling&input=debug&skipGate=1` (E picks up, arrows move, hold and release B to bowl, mouse x steers, Z / C hook) or the bot at `/?sport=bowling&source=synthetic&skipGate=1`. `&short=1` plays two frames.

1. **Pick up.** Close your throwing fist while standing still. Does the ball jump to your hand, and how long does it take? If the fist is not seen, hold the hand low and still: pick-up should happen after about 1.4 s (`pickupHoldMs`, `pickupHoldSpeed`). Tell me which path worked.
2. **Release.** Swing back and forward as if bowling toward the screen. Does the ball release every time, at the moment that feels right? Does the Power meter match your effort across a soft, medium and hard swing? Tunables: `speedFloor`, `speedCeil`, `minReleaseSpeed`, and the throw thresholds in the recognizer config. **This is the riskiest gesture in the game:** a real underarm swing seen from the front reverses direction at the bottom, which the synthetic player does not do.
3. **Direction.** Swing with your arm in its natural line: the ball should go roughly straight. If it drifts one way every time, adjust `neutralLateral` (0.62 sw) and `aimGain` (0.09).
4. **Hook.** I lowered `hookGain` to 0.35 because the synthetic swing saturated the hook on every ball, and real wrist-path curvature is unknown. Do straight swings stay straight? Does a deliberate curved swing hook? Raise `hookGain` if you want more.
5. **Position.** Step left and right: the bowler should move about 0.3 m per shoulder width (`lateralScale`).
6. **Second ball.** After a first ball, does picking up again work with your hand still partly closed?
7. **Pins.** Do they fall believably and settle in reasonable time? Any pins left wobbling or counted wrongly?
8. Known issues: with keyboard and mouse, a straight ball needs the mouse about two thirds of the way across the screen (mouse centre aims left); `E` toggles, so the second pick-up needs two presses; the bowler's body hides the near half of the lane; the ball-return pedestal is partly behind the camera preview.

### Milestone 5: batting

Pick Batting; stand 2 to 2.5 m back, whole body in view, hands together like a bat grip. Without a camera: `/?sport=batting&input=debug&skipGate=1` (S swings, Shift for a harder swing, mouse height sets hand height) or the bot at `/?sport=batting&source=synthetic&skipGate=1`.

1. **Timing offset (the main number).** Swing at all ten pitches trying to hit them, and read the "N ms early / late" line after each. If you are consistently early or late by a similar amount while it feels on time, shift `batTravelMs` (130) by that amount. Tell me the readings.
2. **Windows.** Do `perfectMs` 45, `goodMs` 95, `okMs` 160, `foulMs` 230 feel fair? A late swing should say "Too late", not "Strike": if real swing events arrive more than 250 ms late, raise `lateWindowMs` and `eventDelayAllowanceMs`.
3. **Grip.** Does holding both hands together register as a swing reliably, and does a swing ever start but never finish (hands blurred mid-swing)? Tunables: `swing.gripDistance`, `swing.gripGraceMs` in the recognizer config.
4. **Power.** Do a lazy swing and a hard swing give clearly different distances? Tunables: `powerFloor` 3, `powerCeil` 9, `startSpeedGain` 1.5.
5. **Height.** Hands low, chest-high and high: do you get fly balls, line drives and grounders as expected, and is "Under it / Over it" fair? Tunables: `swToMetres`, `batDrop`, `missHeight`, `launchPerMetre`.
6. **Home runs.** The bot hits one every time (about 100 m), so they are probably too easy. Raise `drag` or lower `maxExit` if they come too cheaply for you.
7. Known issues: the ball is small against the pitcher; the fence is far and faint.

### Milestone 6: archery

Pick Archery; sitting or standing, shoulders and both arms in view. Without a camera: `/?sport=archery&input=debug&skipGate=1` (A selects the bow hand and the mouse places it, D selects the draw hand, E closes it near the bow hand to nock, drag away to draw, E again to release) or the bot at `/?sport=archery&source=synthetic&skipGate=1`.

1. **Bow arm.** Hold your bow arm out to the side. Does the game accept it? Tunables: `bowMinReach`, `bowMaxDrop`.
2. **Nock.** Bring the other hand next to the bow hand and close the fist. The hint should change. If not, note how far apart your wrists were. Tunables: `nockDistance`, `nockGraceMs`.
3. **Draw.** Pull back. The Draw meter should reach 100% at a comfortable full pull. Tunables: `drawStart` 0.5, `drawFull` 2.1 (shoulder widths between the wrists).
4. **Release.** Open the hand. The arrow should leave with the aim you were holding, not where the hand dragged to. Tunable: `releaseLookbackMs` 120. This is the only release in the game that relies on seeing the hand open, so note how reliable it is at your distance.
5. **Aim.** Does the reticle follow the bow hand steadily? If twitchy, lower `aimGainX` / `aimGainY` (0.25) first, then the sway (`maxSwayRad`).
6. **Lost hand.** Hide the draw hand: "Show me your hand" should appear and the draw should hold, cancelling after about 2.5 s.
7. **Fallback.** If the fist is never seen, hold both hands together for 6 s: "Auto-nock" should appear; release by a quick move toward the bow hand or a 2.5 s hold.
8. **Seated.** Play a round sitting down.
9. Known issues: the camera sits close over the archer's shoulder, so the athlete is mostly out of frame and the target is small until the close-up after each shot (camera numbers are tunables: `camBack`, `camHeight`, `camSide`, `fovBase`, `fovDraw`).

### Milestone 7: javelin

Pick Javelin; stand 2 to 3 m back with room to run on the spot and throw. Without a camera: `/?sport=javelin&input=debug&skipGate=1` (U starts, hold ArrowUp to run, Shift to sprint, hold and release T to throw) or the bot at `/?sport=javelin&source=synthetic&skipGate=1`.

1. **Start.** Raise a fist above your head. "Go!" should appear within about half a second even if the game cannot see your fist. An open-hand raise starts after 0.6 s (`openHandHoldMs`).
2. **Run.** Run on the spot for ten seconds. Does the speed readout rise smoothly toward 8 to 9 m/s, without stalls? Do your knees stay in frame? Tunables: `fullCadence` 4.0, `fullAmplitude` 0.45, `maxRunSpeed`, `accel`, `decel`, and `cadence.minLift` in the recognizer config.
3. **False throws.** While running with arms pumping, does a throw ever fire by itself? (`__game.sport.log` in the console lists recent gesture events.) Tunable: `minThrowSpeed`.
4. **Swallowed throws.** Throw overarm in the throw zone while still running. Is the throw ever ignored? The throw recognizer suspends when the shoulders move fast; synthetic running did not trip it but real shoulder bob is larger. If throws are swallowed, set `maxBodySpeedOverride` (for example 8).
5. **Angle.** After each throw the hint shows the release angle the game read. The player throws into the screen, so the angle is a proxy from how upward the wrist was moving at release. Does a flat throw read lower than a lofted one? Tunables: `proxyLow` -0.7, `proxyHigh` 0.9, `angleCurve`.
6. **Foul line.** Release just before the line (valid) and just after (foul). The game back-dates the release by the tracking delay and allows 0.45 s (`crossGraceS`) for a late-arriving throw before calling "You crossed the line".
7. **Distances.** The bot throws 44 to 49 m at about 5 m/s run speed. What do you get, and does a faster run-up clearly help?
8. Known issues: the held javelin sits low at the hip rather than above the shoulder; distance numerals past about 60 m are too small to read.

Playtest checklists for milestone 8 follow once it is complete.
