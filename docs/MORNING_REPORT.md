# Morning report

Kept current through the unattended run that started 2026-11-14. Read this first.

## State of things

- **Milestones 0 to 7 are built, pass every automated check, and are merged to `main`:** repo setup, tracking tech spike, foundation, and all five sports (rock climbing, bowling, batting, archery, javelin). Each sport plays a full round end to end under its closed-loop synthetic player and under mouse, records a score, and has its tunables in the debug panel (`?debug=1`).
- **Nothing has been verified with a real camera, a real person or a real GPU.** Every gesture threshold is tuned to a synthetic player. Expect the first playtest to need tuning, and possibly fixes inside `src/tracking/`.
- **Milestone 8 (launch polish) is done and merged to `main`:** deployment config, security headers (strict CSP), service worker, `docs/DEPLOY.md`, the fixes from two code reviews (accessibility items included), and a memory soak harness (`docs/SOAK.md`).
- **Bonus sport built and merged:** baseball pitching, the sixth menu card.
- **The soak test found a real leak, and it is fixed.** About 1 MB was retained per round played (three.js render objects for earlier rounds' meshes, kept alive through the session-long shared materials). After the fix every sport retains 0.06 to 0.18 MB per round of ordinary heap, geometry and texture counts are identical round after round, and the full 37 minute soak passes.
- Final checks on `main`: typecheck clean, lint clean, 944 unit tests pass, `pnpm build` succeeds, 38 of 38 Playwright end-to-end tests pass, soak 9 of 9, plus the gate (4), UI (35) and deploy (8) suites under their own configs.
- Nothing has been pushed. Nothing has been deployed. No account was logged in to.

**The single most important thing to check first** is the tracking debug page with your real camera (checklist below). Everything else is built on the assumption that it works.

## Playtest round 1 (2026-11-14, branch `playtest-1`)

Allen played every sport, mostly with mouse, and sent notes. All of them were addressed on `playtest-1`. Checks on the branch: typecheck and lint clean, 1048 unit tests, build, default end-to-end 51 of 51, UI 72, gate 4. Soak and deploy suites were not rerun. Still nothing verified by the builders with a real camera.

| Area | What changed | Retest |
|---|---|---|
| How-to card | Capped to the viewport, tighter layout, keys in two columns | Every sport at your screen size, `?input=debug` |
| Cursor | In mouse mode the menu cursor and climbing's in-play circle sit exactly on the pointer; no dwell-select for the mouse | Menus and a climbing round |
| How to play in a round | Button next to Quit, or `H`; pauses the round; Resume, `H` or Escape closes | Any sport |
| Handedness wording | "Dominant hand" replaces "Throwing hand" | How-to card |
| Calibration outline | Relaxed, then one hand raised (handedness step), then T-pose (hold-still step) | Camera calibration |
| Device gate | Measures inference capacity, discards warm-up; fails only below 15 Hz tracking or 27 fps; a fail is now a warning with "Play anyway" (once per browser session). Only missing WebGL2 or Web Workers blocks | Your laptop, without `?skipGate=1` |
| Climbing | Mouse only: click a hold to grab and keep it, the mouse switches to the other hand; a click off a hold does nothing | `?input=debug` |
| Bowling | Scorecard grid fixed; strike or spare called the instant the last pin is down, other rolls 0.7 to 1.2 s after contact, 2.5 s cap; live aim arrows; aim sensitivity cut to about a quarter (`aimGain` 0.09 to 0.025, `maxAngle` 0.1 to 0.045) | Does aim now feel sluggish? |
| Batting | Right-hander on screen left of the plate, left-hander on the right; side-on stance with an animated swing (not a mirror of your arms); about 3.9 s between result and next release with a visible set and wind-up | Both hands. No called balls yet |
| Archery | Nock distance 0.9 to 1.9 sw with hysteresis; nock without a fist by bringing hands together and pulling back; full draw sooner | Camera |
| Javelin | No fist anywhere; run starts after a "Get ready" beat; one big overarm motion throws; run speed is about 36% of the variable release speed; click or `T` throws with the mouse | Camera: does arm pumping while running trigger a throw? Tunables `minThrowSpeed`, `pumpMargin` |
| Pitching | Catcher calls pitch and spot in a speech bubble; 2.6 s read window, no clock on choosing; +3 for the called pitch in the zone, half points for the wrong type; live aim ring; zone and catcher about 45% larger | Pitch choice still uses fist (fastball) or open hand (curve) held 0.9 s. If fist detection misreads, say so and it will be changed |

Known loose ends: the UI test "the calibration outline changes pose with the step" failed once in a full run straight after a laptop restart and passed three times in isolation; the gate suite failed once in the same run and passed on rerun. Watch for repeats. The gate's `marginal` flag has no UI. A background tab during the gate check still reads as slow rendering.

## Playtest round 2 (2026-11-15, branch `playtest-1`)

Second set of notes from Allen. The main change: camera-off mode (`?input=debug`) is now **mouse only**, one button, as easy as possible. Keyboard game controls are removed from `DebugInput`; Escape, `H` and Enter remain as UI keys. Where this section disagrees with the round 1 table above (climbing, javelin mouse controls, bowling timings), this section is current.

Checks on the branch: typecheck and lint clean, 1249 unit tests, build, default end-to-end 53 of 53, UI 73, gate 4. Soak and deploy suites were not rerun. Nothing verified by hand with a mouse or with a real camera.

| Sport | With the mouse | Retest |
|---|---|---|
| Climbing | Press and hold a hold to grab it with the selected hand, drag down to pull up; releasing keeps the grip and switches hands; a press on nothing does nothing. No dominant-hand toggle or handedness calibration step for climbing | Drag feel. Dragging right moves the body left; say if that feels backwards |
| Bowling | Mouse position aims the arrows, hold to wind up, let go to bowl at a fixed speed; no stepping, no hook | Aim is literal and touchy (about 4% of screen width either side of centre covers the lane); `maxAngle`, `mouseAimMinDist` |
| Batting | Click to swing; full power; bat height chosen automatically, only timing matters | Both hands |
| Archery | Move to aim, hold to draw (0.75 s to full), let go to shoot; no sway | |
| Javelin | Hold to run at a fixed 8 m/s, let go to throw at fixed power and loft; release past the line or holding across it is a foul | Throws reach 93 to 96 m against 52 to 61 m for the camera bot, in the same best-score table. Open question for Allen: tune down, or separate tables |
| Pitching | Fastball and Curveball buttons (fastball preselected), hold on the field to aim the ring under the cursor, let go to throw; no assist, fixed speed; throwable 0.7 s after the call | |
| Warm-up | Press the button to close the fist, let go to open | |

Other changes this round:

- **Bowling miscount fixed.** A pin could fall after the count (23 of 99 contact throws in a simulated sweep). The count now waits for wobbling pins and for sliding pins or the ball near a standing pin; slowed pins get extra damping; the count and the next rack share frozen pin states. Zero late falls in a 400-throw sweep. Verdict time after contact: median 1.32 s, 95% within 2.47 s, worst 5.73 s; cap raised to 6 s as a last resort. Strike and spare still called the instant the tenth pin is down. Check that pin falls still look natural.
- **Batting in feet, home run at 350 ft.** Physics stays in metres; the whole flight model is scaled by 1.4224 so every swing goes that much farther and the same swings are home runs. Home-run bonus 94 ft. Markers at 100, 200, 300 ft. The wall is 1.2 m tall, so a home run needs a landing of about 358 ft; 350 to 357 ft is a wall ball scored at 350 ft. Saved bests use a new key (`batting-ft`), so old metre bests are not shown.
- **Running in place (javelin, camera).** The old detector watched only the hip-to-knee gap on screen, which barely changes when knees come toward the camera. The new one fuses arm pump, thigh foreshortening, foot lift (when ankles are visible) and torso bob; any one cue can carry it. Synthetic results: full-body jog detected in about 0.6 s, a single cue alone in 0.9 to 1.1 s, stops within 0.5 s, no false running from standing, weight shifts, arm raises or throws. Thresholds under `recognizerConfig.cadence` (`arm`, `thigh`, `foot`, `bob`) are tuned to synthetic noise only and are the most likely thing to need adjusting on a real camera. `?botStyle=jog` makes the javelin bot jog with arms and torso.

## Playtest round 3 (2026-11-15, branch `playtest-1`)

Third set of notes from Allen. Where this section disagrees with rounds 1 and 2 above (climbing mouse scheme, archery release, pitching aim), this section is current.

Checks on the branch: typecheck and lint clean, 1327 unit tests, build, UI 77 of 77, gate 4 of 4. The default end-to-end suite did not pass in one clean run: 51 of 54 and 52 of 54 on two full runs with different timeouts each time, while a dev server and game tabs were open and tracking in the test browser measured 2 to 3 Hz; every failed test passed when rerun in isolation. Rerun `pnpm build && pnpm test:e2e` with nothing else using the GPU before merging. Soak and deploy suites were not rerun. Nothing verified by hand or with a real camera.

| Area | What changed | Retest |
|---|---|---|
| Climbing, mouse | Grabbing a new hold frees the other hand once the grab has taken (never zero grips). The pointer is unprojected through the camera onto the wall, so the hold under the cursor is the one grabbed and a drag keeps the hold under the cursor. One-hand stamina drain is scaled by `mouseOneHandDrainMult` 0.6 in mouse play only, since the mouse always hangs from one hand | Drag feel, stamina over a full 75 s climb |
| Climbing, camera: flipped arms | Cause: full-frame hands are assigned to left and right slots by nearness to each slot's last position; a fisted hand that dropped out could come back in the wrong slot and stay there. Assignment now weighs how stale each slot is, and slots swap back if the hands read in the wrong left/right order (more than 0.12 apart) for 12 frames | Whether flips are gone. Deliberately crossed hands held longer than about 0.4 s are swapped; say if a cross-reach grip breaks |
| Pose left/right guard (other sports) | `src/input/sideGuard.ts` undoes a sudden whole-body or arm-only left/right exchange between consecutive frames. Gradual turns, including past side-on, are never touched | Watch for odd arm jumps in pitching, javelin, batting; `inputConfig.sideGuard.enabled` turns it off |
| Turn camera on | Button in the top right on title, menu, how-to and results in mouse mode. It reloads the page with `input=debug` removed and other flags kept | The real permission prompt after the reload |
| Hand cursor | Hidden and inert during active play in every sport; back for pause, how-to, results, lobby. Mouse, Escape and `H` still work in play. A camera player pauses hands-free by stepping out of frame | |
| Archery | An arrow fires only on a positive release: an open hand confirmed for 40 ms, or the wrists closing fast (5 to 14 sw/s, both wrists clearly visible, fist not closed). Lost wrists freeze the draw for 700 ms ("Draw (hold on)"), then the bow eases down with no shot and no penalty. A hand that comes back already open shoots after a 200 ms confirm. Full draw needs less separation (`drawFull` 1.65) and a side-on bow arm counts as raised | `lostGraceMs`, `collapseSpeed`, `drawFull` on a real camera |
| Pitching, camera | The glove hand (non-dominant) places the ring: about half a shoulder width each way in front of the chest covers the zone. The ring locks while the throwing wrist is fast. The throwing arm sets speed and steers by at most 0.15 m. Glove hand not seen: ring holds 800 ms then eases to centre; a throw is never blocked. Zone assist lowered to 0.15. Pitch choice is still fist or open hand; mouse mode unchanged | Glove box (`gloveNeutralX/Y`, `gloveGainX/Y`), `lockSpeed`, steering range |

Loose ends: pitching reads pose visibility for the glove wrist straight from `state.pose` (a tracked flag on `ArmState` would be the proper home; contract change not made). The slot constants in `src/tracking/camera/slots.ts` are module constants, not tunables. An orphaned wait loop from a round 2 builder ran for 18 hours before it was noticed and stopped; it did nothing but sleep.

## Playtest round 4 (2026-11-15, branch `playtest-1`)

Fourth set of notes from Allen, plus two new features started (tutorials, and a plan for pass-and-play multiplayer). Where this section disagrees with earlier ones (hand cursor, batting and javelin detection), this section is current.

Checks on the branch: typecheck and lint clean, 1713 unit tests, build, default end-to-end 58 of 58, UI 99 of 99, gate 4 of 4. Soak and deploy suites were not rerun. Nothing verified by hand or with a real camera.

| Area | What changed | Retest |
|---|---|---|
| Batting swing detection | Cause of "nothing happens" side-on: speeds are in shoulder widths taken from the live image, which collapses in profile, and a hidden far shoulder made the player count as not tracked. The body scale now comes from torso length and a learned shoulder-to-torso ratio (median of square-on frames, seeded by calibration); a faint far shoulder is accepted; a swing is read from both wrists or the one that is visible. A swing is announced once it holds 4 sw/s for a moment and is mostly sideways; waggles and grip flicks are ignored | **Swing direction.** `forward` comes from the dominant hand (right-handed: toward screen right). Hands moving the other way count only at 7.2 sw/s (`swing.backwardFactor` 1.8). If swings feel ignored, check which way you face first |
| Javelin throw detection | The throw detector no longer stands down for body movement mid-throw (`maxBodySpeed` 9 for javelin); the wrist only has to have gone over the shoulder at some point (`minThrowTopY`); a weak cocking motion cannot hide the throw after it; a mostly upward motion is refused ("Throw forward, not up") | `minThrowSpeed` went from 3 to 6 so that cocking the arm is not a throw; a gentle throw gets "Throw faster". Lower it first if throws feel hard |
| Hints | Batting and javelin say why a motion did not count: "Swing faster", "Swing across, not up", "Swing seen too late", "Bring your hand up past your shoulder", "I lost your arm, step back a little". No hints from arm pump while running | Whether the hints match what you did |
| Hand cursors | One cursor per tracked hand (L and R badges); they never swap. An open hand only highlights. A hand that closes into a fist over a button and holds 250 ms selects, once; it must have been seen open over that button first. New line: "Point at a button and make a fist to choose it." | Fist reliability at distance; whether "seen open over the same button" is too fussy (can relax to "seen open anywhere") |
| Hand tracking in the lobby | Fist select needs hand state, so hand crops now run on menu screens and whenever a pause, how-to or results overlay is up. They load in the background after the menu appears; pose frames no longer stall while a hand model loads (`CameraLandmarkSource.setNeeds`) | How long after the menu appears a fist starts working |
| Wording | "Raise the hand you throw with" is now "Raise your dominant hand"; same in pitching and javelin copy. The climbing setup picture shows one left and one right hand | |
| Tutorials | A "Tutorial" button on the start screen for sports that have one (`SportMeta.hasTutorial`); never opened automatically. Step panel at bottom centre with "Skip step" and "End tutorial" (mouse any time, `S` skips; a camera player steps out of frame to pause and uses a fist). "Tutorial done" offers "Play now" (no recalibration) or "Back to menu". Nothing saved. Climbing has one: 7 camera steps, 6 mouse steps, no timer, cannot fall. `?tutorial=1` starts a sport in tutorial mode | Climbing tutorial on camera. Other five sports: not built yet |

**Recording real clips** (the most useful next input: every new detection threshold is fitted to a harder synthetic player, not a person):

1. `pnpm dev`, open `http://localhost:5173/debug.html`, source camera, tracker "Pose", stand 2 to 3 m back with the whole body in view.
2. Click Record, face the camera for one second (body proportions are learned then), turn if the clip is side-on, do one move, click "Stop and save".
3. Make 3 to 5 each of: side-on swing, facing swing, javelin throw while jogging on the spot; left and right if possible. Plus negatives: standing, walking in, raising hands, a bat waggle, jogging with arm pump.
4. Name them `batting-side-right-1.json`, `batting-facing-left-1.json`, `javelin-jog-right-1.json`, `negative-waggle.json` and so on, and put them in `tests/recordings/`.
5. `RECORDINGS_VERBOSE=1 pnpm exec vitest run src/input/recognizers/recordings.test.ts` replays them and prints every event with speeds.

Loose ends: fully side-on archery reads a full draw only 6% above `drawFull` 1.65 (unchanged by this round, but worth a try; lowering to about 1.4 is the fix if it is hard). An existing test still requires a swing that started with both hands clearly visible to be dropped if one disappears for 220 ms. Whole-game end-to-end tests now carry explicit time limits (bowling, climbing, pitching mouse rounds, the camera path) because they play in real time; the global 60 s limit is unchanged. No unit test covers the `setNeeds` frame gating (no harness for `CameraLandmarkSource`). Pitching still reads glove-wrist visibility from `state.pose`.

## Tutorials for every sport (2026-11-15, branch `playtest-1`)

All six sports now have an optional tutorial behind the "Tutorial" button on the start screen. Checks on the branch: typecheck and lint clean, 1807 unit tests, build, default end-to-end 85 of 85, UI 99 of 99, gate 4 of 4. Camera steps are verified only under the synthetic player; mouse steps by real mouse events in the browser tests. Nothing tried by hand.

| Sport | Camera steps | Mouse steps | Try first on a real camera |
|---|---|---|---|
| Climbing | 7: show hands, grab, other hand, pull, regrab higher, rest on two hands, climb to a flag at 3 m | 6 | The 2.2 s two-hand rest step |
| Bowling | 7: get in view, fist to pick up, line up the arrows, swing and let go (waits for the ball to be scored), knock down what is left (or "A strike! Bowl again"), hook, one free frame | 5 | Whether "Draw your arm further back first" and "Swing a bit faster" show at the right moments |
| Batting | 6: get in view, hands together (says which way to swing for your dominant hand), practice swing with no ball, a faster one (shows power), slow pitches until one is hit, up to three at full speed | 3 | Steps 2 and 3: they state the expected swing direction and show why a swing did not count |
| Archery | 7: get in view, bow arm out, nock with a fist, full draw, aim, open hand to shoot, two more | 4 | "I lost your hand. Hold on, the draw is safe" timing |
| Javelin | 6: get in view, jog, jog faster, standing practice throw (every refusal reason shown), run-up and throw before the line, one more | 3 | Step 4 for why throws are refused; the athlete is held 12 m short of the line while jogging |
| Pitching | 7: get in view, glove hand steers the ring, hold it on a square, throw, fist for fastball, open for curveball, match the catcher's call | 4 | Fist and open-hand reads in steps 5 and 6 (accepts a fallback after two failed reads) |

In every tutorial: no timer, no limits on attempts, nothing that can be lost, nothing saved, "Skip step" and "End tutorial" always available (mouse or `S`; a camera player pauses by stepping out of frame). A review confirmed normal rounds are unchanged and "Play now" inherits nothing from the tutorial.

Loose end: `e2e/game.spec.ts` "the how-to overlay pauses the round and resumes it" has failed twice across many full runs (phase still `paused` after Escape closes the overlay), both times on a heavily loaded machine, and passed every other time. Not yet explained; watch for it.

## Pass-and-play multiplayer (2026-11-16, branch `playtest-1`)

Local multiplayer for all six sports. Allen's decisions: always pass-and-play (one player on camera at a time), up to 4 players, every player types a name, no simultaneous play, no pitcher-against-batter mode. Single player is unchanged (confirmed by two reviews and by the untouched single-player tests).

Checks on the branch: typecheck and lint clean, 1970 unit tests, build, default end-to-end 100 of 100, UI 129 of 129, gate 4 of 4. Verified with the synthetic player and with real mouse events only. **Nothing has been tried with real people**: the step-in, per-player calibration and camera handover are the least tested parts of the game.

How it works:

- **Start screen:** a Players choice, 1 to 4. With 2 or more, Play goes to a names screen: one field per player (12 characters, prefilled with the names last used on this device), and in mouse mode a Left / Right dominant-hand choice per player for sports that use it. Tutorial always starts single player.
- **Setup on camera:** each player in turn gets "Mia, step in" and then the sport's normal calibration, including the dominant-hand step. Each player's calibration and hand are kept for the session.
- **Colours:** coral, blue, sunny yellow, lavender, on the athlete's mitts and feet, the name chip and the results row. Names always appear beside the colour; two players with the same name show as "Mia (blue)".
- **Turns:** see the table. Standings sit in the bottom-left corner with a star on the leader.
- **Handover:** the round pauses and a "Mia, you're up" card shows the standings. On camera it continues by itself once it has been up 2 s, the frame has been empty for 0.7 s, and someone has then stood still for 1 s. If nobody leaves the frame it waits, and after 6 s says "Swap places, or make a fist on Ready". A fist or click on Ready, or Enter, always works. With the mouse: Ready only. The card reads "Go" for 0.8 s before play resumes. Tracking state (movement in progress, body-size estimate) is reset for each player.
- **Results:** ranked table, ties share a rank, "Mia wins" or "It's a tie", then Play again (same players, no retyping or recalibrating), Change names, Back to menu. Nothing from multiplayer is saved to scores or bests. Names and dominant hands are remembered on the device.
- **Flags:** `?players=2..4`, `?names=Mia,Sam`, `?hands=r,l` with `?sport=` start a game directly.

| Sport | A turn is | Notes |
|---|---|---|
| Archery | one arrow | Same wind for everyone on the same arrow number; each arrow on the target carries a bead in its shooter's colour |
| Bowling | one frame | Fresh full rack and reset physics every turn; own scorecard per player, name in the first cell; rack and arm switch sides for a left-hander |
| Batting | one set of pitches | Everyone faces the same pitches; batter's side of the plate, stance and expected swing direction follow the player's hand |
| Javelin | one attempt | A pennant in each player's colour marks their best; standings show best so far or "no mark" |
| Pitching | one set of pitches | Everyone gets the same catcher's calls; glove hand, aim, curve break follow the player's hand; zone dots cleared between players |
| Climbing | a whole climb | Same wall; lines in earlier players' colours mark their heights; ranked by height shown, then faster time |

Retest with real people, in this order: (1) the camera handover: does the card continue at the right moment when players swap, and never while the same player is still standing there; (2) a fist on Ready from playing distance; (3) a left-hander following a right-hander in batting, pitching, bowling and javelin; (4) whether identical pitches for every batter feel fair or repetitive; (5) the "Go" card and the four colours by eye (never looked at outside the test browser).

Loose ends: the bowling scorecard cannot colour a cell, so the name there is plain text. Climbing's wall lines carry no names. Joined-emoji names count as one character each.

## How to run

```
pnpm install
pnpm setup:assets     # once: copies MediaPipe WASM, downloads the three models (about 23 MB)
pnpm dev              # http://localhost:5173
```

- The game: `http://localhost:5173/` (the device gate runs first; add `?skipGate=1` to bypass it while testing)
- Watch a bot play a sport: `/?sport=bowling&source=synthetic&skipGate=1` (ids: `climbing`, `bowling`, `batting`, `archery`, `javelin`; add `&short=1` for a short round, `&timeScale=3` to fast-forward)
- Play with mouse: `/?input=debug&skipGate=1` (each sport's how-to screen lists its mouse controls)
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
- **2.2 / 2.3 Recognizers and providers.** Arm raise, knee-lift cadence, throw (underarm and overarm, release stamped at the wrist-speed peak), two-handed swing, punch, squat, jump; `TrackedInput`; `DebugInput` (mouse). 220 unit and integration tests against the synthetic player across five noise seeds. **All recognizer thresholds are tuned to synthetic motion and are placeholders.**
- **2.7 (logic) Calibration session, 2.9 Scores, avatar animator, move queue.** Unit-tested.
- **2.4 Game shell and 2.6 interface.** Boot, gate, title, camera intro, menu, how-to, calibration, play, pause when out of frame, results; hand cursor with hold-to-select, mouse and keyboard on every screen; HUD, corner mirror view, synthesised sounds, tunables panel. Verified by Playwright through the real UI with the fake camera, the bot and keyboard input, and by looking at screenshots of every screen at 720p and 1080p.
- **Milestones 3 to 7, the five sports.** Each has pure, unit-tested rules and scoring (bowling's ten-frame scoring and Rapier pin physics run under Vitest), a bot, and Playwright rounds under the bot and under keyboard input. I looked at mid-round screenshots of each against the Field Day theme. Bot results in short rounds: climbing about 11 m; bowling 17 to 47 over two frames (139 in one full game); batting three hits of about 100 m; archery rings of 8 to 10; javelin 44 to 49 m.
- **Two independent code reviews (opus)**, one of tracking and input, one of sports, shell and UI. The first found 8 defects (one high: a start/stop race that could leave the camera on), all fixed. The second found 14 (none high); fixes are in progress.
- **8.2 Deployment.** `wrangler.jsonc`, `public/_headers`, service worker, `docs/DEPLOY.md` covering both DNS cases. Playwright confirms the whole game, the MediaPipe pipeline and Rapier run under the production CSP, that a cross-origin `fetch` is blocked, and that the shell loads offline after one visit. `wrangler deploy --dry-run` passes offline.

## Parked

Nothing was parked: no task failed three attempts. What is unfinished is unfinished because it needs you at a camera (see the checklists), not because it broke.

## What I would do first tomorrow

1. Run the milestone 1 checklist on the debug page. If tracking does not start, or runs far below 30 Hz, stop there and tell me the numbers and any error text: everything else depends on it.
2. Record the clips listed in that checklist into `tests/recordings/`. They let the recognizers be retuned and tested against real motion without you standing at the camera each time.
3. Play climbing (hands only, the simplest pipeline), then bowling (the riskiest gesture), and note what the checklists ask for.
4. Decide the two open performance questions from the numbers: Pose lite or full, WebGPU or WebGL renderer.

## Things I noticed that need your eyes

- The synthetic bowling swing is a simplified diagonal sweep. A real underarm swing seen from the front reverses direction at the bottom, which the throw recognizer has not seen yet. Record real clips early (checklist below).
- The throw recognizer suspends itself when the shoulders move faster than 3 sw/s, to stop sidesteps looking like throws. A real javelin run-up may trip this (`recognizerConfig.throw.maxBodySpeed`).
- A fast arm raise can register as a throw. Sports ignore throws outside their throwing phase.
- Fist detection at 2 m is the least proven signal. Bowling, archery, javelin and pitching each have a fallback that works without it (hold still, auto-nock, open-hand raise, default fastball), so no sport depends on it to be playable.
- Javelin and pitching read the throw's height from how upward the wrist moves in the image, because the player throws into the screen. Both mappings were fitted to the synthetic player and will need retuning (`proxyLow`, `proxyHigh` in each sport's config).
- Framing is weak in archery (the archer is mostly out of frame) and the catcher in pitching is small. The climber, bowler, batter and javelin thrower read well.
- The gate's thresholds (25 Hz tracking, 50 fps rendering) are provisional and have only ever been evaluated on software rendering, where the gate correctly fails.
- The headless tracker runs at about 3 Hz on software GL, so every automated check of the camera path proves only that the pipeline starts and delivers frames, nothing about speed or accuracy.
- `docs/DEPLOY.md` flags a few Cloudflare details (dashboard menu names, rollback retention) as "check the current docs" rather than asserting them.
- The CI workflow has never run, because nothing has been pushed.
- Chunk sizes: the build warns about large chunks (three.js, and Rapier's 4.3 MB lazy chunk with inlined WASM). They load fine and are cached by the service worker; I did not split them.

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
| Review fixes, batch 1 (tracking and input) | builder | sonnet |
| Polish (banner, UI scaling, feet, gate canvas) | builder | sonnet |
| 3 Rock climbing | builder | sonnet |
| 4 Bowling | builder | sonnet |
| 5 Batting | builder | sonnet |
| 6 Archery | builder | sonnet |
| 7 Javelin | builder | sonnet |
| 8.2 / 2.10 Deployment, CSP, service worker | builder | sonnet |
| Shared fixes found by the sports (batch 2) | builder | sonnet |
| Review of sports, shell and UI | reviewer | opus |
| Second-review fixes (batch 3), incl. 8.1 accessibility | builder | sonnet |
| 8.3 Memory soak test | builder | sonnet |
| Baseball pitching | builder | sonnet |
| Renderer memory leak fix | builder | sonnet |

The orchestrator (this session) wrote the docs, the type-only contract files, `playwright.sport.config.ts`, and a handful of one-line fix-ups (two config defaults, lint ignore patterns, wiring `?short=1`); everything else was written by the subagents above.

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

Open `http://localhost:5173/`, pick Rock climbing. Sit or stand about 1 m from the camera with both hands in view. Without a camera: `/?sport=climbing&input=debug&skipGate=1` (move the mouse over a hold, press and hold to grab, drag down to pull up; letting go keeps your grip and switches hands) or watch the bot at `/?sport=climbing&source=synthetic&skipGate=1`. Add `&debug=1` for the tunables panel.

1. **Grab.** Hold a hand over a hold: it should brighten and grow slightly. Close the hand: the mitt snaps on and a sound plays. Note whether grabs register reliably. Tunables: `grabWindowMs` 250, `jugRadius` 0.17, `crimpRadius` 0.10.
2. **Pull.** Pull the closed hand down: the climber rises about 1.5 m per full image height. Does tracker jitter shake the body? Tunables: `reachWidth`, `reachHeight`, `reachOffsetY`, `followRate`, `maxClimbSpeed`.
3. **Alternate hands for a minute.** Count unintended drops (the fist flickered or the hand was lost for a moment). Tunables: `lostHandGraceMs` 500, `slipGraceMs` 350, and the fist thresholds in the input config.
4. **Stamina and ledges.** Can you reach the first rest ledge at 20 m? I lowered the drain rates (two hands 0.02/s, one hand 0.035/s) after the bot ran out near 11 m; judge whether it is now too easy. Tunables: `drainTwoHands`, `drainOneHand`, `ledgeEveryM`.
5. **Comfort.** Is the top of the reach comfortable, and do your hands stay in frame? Does a 75 second round tire your arms too much?
6. Known cosmetic issue: a hand held below shoulder height can hide behind the torso.

### Milestone 4: bowling

Pick Bowling; stand about 2 to 2.5 m back, whole body in view. Without a camera: `/?sport=bowling&input=debug&skipGate=1` (move the mouse to aim the arrows, hold the button to wind up, let go to bowl) or the bot at `/?sport=bowling&source=synthetic&skipGate=1`. `&short=1` plays two frames.

1. **Pick up.** Close your throwing fist while standing still. Does the ball jump to your hand, and how long does it take? If the fist is not seen, hold the hand low and still: pick-up should happen after about 1.4 s (`pickupHoldMs`, `pickupHoldSpeed`). Tell me which path worked.
2. **Release.** Swing back and forward as if bowling toward the screen. Does the ball release every time, at the moment that feels right? Does the Power meter match your effort across a soft, medium and hard swing? Tunables: `speedFloor`, `speedCeil`, `minReleaseSpeed`, and the throw thresholds in the recognizer config. **This is the riskiest gesture in the game:** a real underarm swing seen from the front reverses direction at the bottom, which the synthetic player does not do.
3. **Direction.** Swing with your arm in its natural line: the ball should go roughly straight. If it drifts one way every time, adjust `neutralLateral` (0.62 sw) and `aimGain` (0.09).
4. **Hook.** I lowered `hookGain` to 0.35 because the synthetic swing saturated the hook on every ball, and real wrist-path curvature is unknown. Do straight swings stay straight? Does a deliberate curved swing hook? Raise `hookGain` if you want more.
5. **Position.** Step left and right: the bowler should move about 0.3 m per shoulder width (`lateralScale`).
6. **Second ball.** After a first ball, does picking up again work with your hand still partly closed?
7. **Pins.** Do they fall believably and settle in reasonable time? Any pins left wobbling or counted wrongly?
8. Known issues: with mouse, `E` toggles, so the second pick-up needs two presses; the bowler's body hides the near half of the lane; the ball-return pedestal is partly behind the camera preview.

### Milestone 5: batting

Pick Batting; stand 2 to 2.5 m back, whole body in view, hands together like a bat grip. Without a camera: `/?sport=batting&input=debug&skipGate=1` (click to swing as the ball reaches the plate) or the bot at `/?sport=batting&source=synthetic&skipGate=1`.

1. **Timing offset (the main number).** Swing at all ten pitches trying to hit them, and read the "N ms early / late" line after each. If you are consistently early or late by a similar amount while it feels on time, shift `batTravelMs` (130) by that amount. Tell me the readings.
2. **Windows.** Do `perfectMs` 45, `goodMs` 95, `okMs` 160, `foulMs` 230 feel fair? A late swing should say "Too late", not "Strike": if real swing events arrive more than 250 ms late, raise `lateWindowMs` and `eventDelayAllowanceMs`.
3. **Grip.** Does holding both hands together register as a swing reliably, and does a swing ever start but never finish (hands blurred mid-swing)? Tunables: `swing.gripDistance`, `swing.gripGraceMs` in the recognizer config.
4. **Power.** Do a lazy swing and a hard swing give clearly different distances? Tunables: `powerFloor` 3, `powerCeil` 9, `startSpeedGain` 1.5.
5. **Height.** Hands low, chest-high and high: do you get fly balls, line drives and grounders as expected, and is "Under it / Over it" fair? Tunables: `swToMetres`, `batDrop`, `missHeight`, `launchPerMetre`.
6. **Home runs.** The bot hits one every time (about 100 m), so they are probably too easy. Raise `drag` or lower `maxExit` if they come too cheaply for you.
7. Known issues: the ball is small against the pitcher; the fence is far and faint.

### Milestone 6: archery

Pick Archery; sitting or standing, shoulders and both arms in view. Without a camera: `/?sport=archery&input=debug&skipGate=1` (move the mouse to aim, hold the button to draw, let go to shoot) or the bot at `/?sport=archery&source=synthetic&skipGate=1`.

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

Pick Javelin; stand 2 to 3 m back with room to run on the spot and throw. Without a camera: `/?sport=javelin&input=debug&skipGate=1` (hold the button to run, let go just before the line to throw) or the bot at `/?sport=javelin&source=synthetic&skipGate=1`.

1. **Start.** Raise a fist above your head. "Go!" should appear within about half a second even if the game cannot see your fist. An open-hand raise starts after 0.6 s (`openHandHoldMs`).
2. **Run.** Run on the spot for ten seconds. Does the speed readout rise smoothly toward 8 to 9 m/s, without stalls? Do your knees stay in frame? Tunables: `fullCadence` 4.0, `fullAmplitude` 0.45, `maxRunSpeed`, `accel`, `decel`, and the step-cue thresholds under `recognizerConfig.cadence` (`arm`, `thigh`, `foot`, `bob`, `runThreshold`, `stopThreshold`).
3. **False throws.** While running with arms pumping, does a throw ever fire by itself? (`__game.sport.log` in the console lists recent gesture events.) Tunable: `minThrowSpeed`.
4. **Swallowed throws.** Throw overarm in the throw zone while still running. Is the throw ever ignored? The throw recognizer suspends when the shoulders move fast; synthetic running did not trip it but real shoulder bob is larger. If throws are swallowed, set `maxBodySpeedOverride` (for example 8).
5. **Angle.** After each throw the hint shows the release angle the game read. The player throws into the screen, so the angle is a proxy from how upward the wrist was moving at release. Does a flat throw read lower than a lofted one? Tunables: `proxyLow` -0.7, `proxyHigh` 0.9, `angleCurve`.
6. **Foul line.** Release just before the line (valid) and just after (foul). The game back-dates the release by the tracking delay and allows 0.45 s (`crossGraceS`) for a late-arriving throw before calling "You crossed the line".
7. **Distances.** The bot throws 44 to 49 m at about 5 m/s run speed. What do you get, and does a faster run-up clearly help?
8. Known issues: the held javelin sits low at the hip rather than above the shoulder; distance numerals past about 60 m are too small to read.

### Bonus: baseball pitching

Pick Pitching; stand 2 to 2.5 m back, whole body in view. Without a camera: `/?sport=pitching&input=debug&skipGate=1` (click Fastball or Curveball, press and hold on the field to aim the ring, let go to throw) or the bot at `/?sport=pitching&source=synthetic&skipGate=1`.

1. **Sign.** Hold your throwing hand still at your side with a fist: the meter should fill and say Fastball. Open hand: Curve. If the hand cannot be read it says so and picks a fastball after 2.5 s. Tunables: `signStillSpeed`, `signHoldMs`, `signFallbackMs`.
2. **Aim.** Throw overarm at the lit tile. Release with your hand further out, then closer in: the pitch should move the same way. Throw higher and lower. The vertical aim is a proxy from how upward the wrist moves at release and **must be tuned on your recordings**: `proxyLow`, `proxyHigh`, `heightRange`; horizontal: `neutralLateral`, `aimGainX`; forgiveness: `assist`.
3. **Speed cap.** Throw soft and hard: km/h rises, but the speed bonus stops growing at 95 km/h on purpose. Do not throw hard to test it.
4. **Curve.** It should land lower and toward the glove side.
5. **Pitch clock.** Wait 12 s without throwing: "Balk". A throw with the other hand is ignored.
6. Known issues: the catcher is small and pale; the strike zone is drawn 2.8 times larger than the scored one so it can be read from the mound.

### Milestone 8: launch polish

1. **Menus by hand.** After Start and the camera prompt, raise a hand: a mitt cursor should appear. Hold it over a card for about a second to select. It should not select anything in the first 1.2 s of a new screen. Is the reach comfortable, and is the dwell time right?
2. **Keyboard only.** Tab or arrow keys move focus, Enter selects, Escape goes back or quits a round. Try the whole flow without the mouse.
3. **Camera indicator.** A "Camera on" pill with a "Turn camera off" button should be visible on every screen once the camera is running. Turning it off should stop the camera light and drop you to mouse play.
4. **Out of frame.** During a round, walk out of view: the game should pause with a large message and resume when you return.
5. **Calibration.** Before each camera round: step into the outline, raise your throwing hand, hold your arms out. Try raising the left hand: the sport should then be left-handed. For climbing and archery, try the "Sitting" toggle.
6. **Left-handed with mouse.** The how-to screen has a "Throwing hand" toggle; `?hand=left` sets the default.
7. **Device gate.** Open `/` without `?skipGate=1`. It should pass on your machine within a few seconds; write down the numbers behind "Details" if it fails. Thresholds (25 Hz tracking, 50 fps rendering) are provisional.
8. **Deployment.** Follow `docs/DEPLOY.md`. First find out where the DNS for `allenzheng.com` lives (`nslookup -type=NS allenzheng.com`); the guide covers both cases. `pnpm deploy:dry` checks everything without touching your account.
