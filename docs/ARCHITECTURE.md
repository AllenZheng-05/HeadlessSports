# Architecture

## What we are building

Headless Sports is a Wii Sports-style collection of sports mini-games that runs entirely in the browser, with **no controller**. The player stands in front of their computer's webcam, a computer-vision model tracks their body and hands, and their movements control a simple 3D athlete. It will live at `sports.allenzheng.com` (Allen owns `allenzheng.com`; other games may get their own subdomains later, so this repo is only this game).

The sports are ones where the player does one thing at a time: throw, swing, grab, run in place. Each sport is a short, replayable round with a score or high score.

The look is Wii Sports-like: very simple low-poly 3D, soft colours, simple recreations of each venue. The playable athlete has **no defining features and no head**: a torso, arms, legs, hands and feet, and nothing else. That headless figure is the game's identity and where the name comes from.

## Hard constraints

- **Browser only, static site.** No game server. All computer vision runs on the player's device; camera video never leaves the browser.
- **Desktop and laptop only.** Do not build mobile layouts, touch controls, or low-power fallbacks.
- **A warning gate, not graceful degradation.** If a device is mobile, small or too slow, show a friendly "this device may struggle" warning and let the player continue with "Play anyway". Do not lower quality to accommodate weak devices. There is one fixed quality configuration for every machine. Only a missing capability the game cannot start without (WebGL 2, Web Workers) is a terminal screen. (The research suggested adaptive quality tiers, a 15 Hz low-end mode and mobile support; Allen has rejected all three.)
- **Smoothness matters a lot.** A game doing real-time vision and 3D at once is heavy for a browser, so treat the performance requirements below as requirements, not polish.
- **Easy to add sports.** Allen expects to add many more sports over time. A new sport should be a new module that reuses shared tracking, gesture recognition, avatar and UI code.

## Tech stack (researched November 2026)

Use this stack. The alternatives were evaluated and rejected for the reasons given; do not revisit them without a concrete problem.

| Layer | Choice | Notes |
|---|---|---|
| Tracking | `@mediapipe/tasks-vision` | Pose Landmarker **lite** and Hand Landmarker. GPU delegate, with CPU fallback if GPU init fails. Apache-2.0, actively maintained |
| Smoothing | One Euro filter, our own small implementation | Per landmark, per axis |
| Rendering | three.js, imported from `three/webgpu` | `WebGPURenderer` with its automatic WebGL2 fallback, plus a flag to force `WebGLRenderer`. `MeshToonMaterial` |
| Physics | Hand-written kinematics; Rapier for bowling pins only | `@dimforge/rapier3d-compat`, lazy-loaded inside the bowling module |
| Avatar | Procedural primitives, our own two-bone IK, procedural animation clips | No rigged model, no Kalidokit |
| Language and build | TypeScript (strict), Vite, pnpm, Vitest | ESLint and Prettier |
| UI | Plain DOM over the canvas | Add Preact or Svelte only if menus outgrow plain DOM. No React in the game loop |
| Hosting | Cloudflare static assets (Workers static assets or Pages) | Free unlimited static requests; 25 MiB per-file limit, which our model and WASM files fit under |
| Scores | IndexedDB first; later a Cloudflare Worker with D1 for a global leaderboard | |

Versions seen during research: three.js r187, `@mediapipe/tasks-vision` 1.1.x to 1.2.x, Rapier 0.21.x. **Check npm for the current stable releases, then pin exact versions** (no `^`, no `@latest`); MediaPipe's `latest` tag was inconsistent across mirrors.

### Why the alternatives lost

- **TensorFlow.js pose-detection (MoveNet, BlazePose):** effectively unmaintained since 2023.
- **ONNX Runtime Web with RTMPose or YOLO-pose:** heavier, you must build the detector-tracker pipeline yourself, and Ultralytics YOLO is AGPL.
- **MediaPipe Holistic:** pays for face tracking we don't need and has the same far-hand problem.
- **MediaPipe Gesture Recognizer:** fine for a prototype, but our own classifier on the 21 hand landmarks is more controllable.
- **LiteRT.js:** promising WebGPU inference, but new and it drops MediaPipe's built-in pipeline. Note it in the roadmap as a later option if MediaPipe's WebGL path becomes the bottleneck.
- **Babylon.js, PlayCanvas, Unity or Godot web exports, React Three Fiber:** larger bundles, slower startup, or per-frame overhead with no benefit for small mini-games.
- **cannon-es, Ammo.js, Havok:** slower, awkward, or tied to Babylon. Jolt is the fallback if Rapier's pin stacking misbehaves.

### Facts that shape the build

- MediaPipe's web GPU delegate runs on **WebGL2, not WebGPU**, so the tracker and the renderer compete for the same GPU. Build a switch between the WebGPU and WebGL renderers (`?renderer=webgl`) in milestone 1; Allen will measure both on his machine with the tracker running and pick one as the fixed configuration.
- MediaPipe vision is single-threaded WASM and needs no `SharedArrayBuffer`, so **no COOP/COEP headers** are required.
- MediaPipe's detect calls are synchronous and block their thread, so they must run in a **Web Worker**.
- Self-host the MediaPipe WASM (about 12 MB) and the `.task` model files (pose lite about 5.5 MiB, hand about 7.5 MiB) from our own origin. No CDN at runtime.

## Architecture

```
[Camera] getUserMedia 1280x720@30
   |  main thread: requestVideoFrameCallback + createImageBitmap, transferred (zero-copy)
   v
[Tracking Worker]  Pose Landmarker lite -> wrist ROIs -> Hand Landmarker on crops
   |  posts {t_capture, pose2D, poseWorld, hands[], confidences} as transferable Float32Arrays
   v
[Input Layer, main thread]  One Euro filters -> kinematics (velocities, angles, body scale)
   |                         -> gesture recognizers (state machines)
   v
[Game Event Bus]  typed events + a continuous filtered pose snapshot for the avatar
   v
[Sport Module, lazy-loaded]  { id, requiredTrackers, calibrate(), onEvent(), update(dt), render(), dispose() }
   |  shared kit: AvatarRig, toon materials, KinematicBody, HUD, audio, scores
   v
[three.js renderer at display rate, avatar interpolated between tracker samples]
[Scores: IndexedDB now, Worker + D1 API later]
```

- Frame transport: the universal path is `requestVideoFrameCallback` plus `createImageBitmap` on the main thread, transferred to the worker and closed after use. `MediaStreamTrackProcessor` in the worker is an optional fast path where supported; feature-detect it.
- Browser targets: desktop Chrome and Edge first, then Firefox, then desktop Safari. Safari's WebGL2-in-worker behaviour is uncertain, so keep a main-thread tracking fallback for the case where worker initialisation fails.
- The renderer stays on the main thread.
- Each sport is loaded with dynamic `import()`, with its own assets and (for bowling) Rapier.
- Suggested layout (may be adjusted as needed): `src/tracking/` (worker, frame source, models), `src/input/` (filters, kinematics, recognizers), `src/core/` (event bus, game loop, sport interface, gate, scores), `src/render/` (renderer setup, avatar, style kit), `src/ui/` (menus, HUD, onboarding), `src/sports/<name>/`, `src/debug/`, `public/models/`, `public/wasm/`, `tests/recordings/`, `docs/`.

## Performance requirements

1. Inference runs in a dedicated worker; frames are transferred, never copied.
2. Inference at camera rate (30 Hz); rendering at display rate, interpolating the avatar between the two latest filtered poses.
3. Pose lite on a downscaled frame; hand crops from the full-resolution frame only in phases that need them.
4. Only the trackers the current sport needs are loaded; unused ones are closed.
5. **No allocation per frame** in the game loop or the landmark path: pre-allocate vectors and matrices, reuse typed arrays, no closures created per frame. Garbage-collection pauses show up as input hitches.
6. Under about 100 draw calls per frame: instancing for repeated props (holds, pins), merged static geometry.
7. No post-processing, no real-time shadow maps (blob shadows instead), device pixel ratio capped at 1.5.
8. Toon materials with flat vertex colours; no textures unless a sport really needs one. Any `.glb` assets are Meshopt-compressed.
9. Fixed-timestep physics at 120 Hz, decoupled from rendering.
10. Versioned, self-hosted WASM and models with long-lived immutable cache headers; a service worker precaches the shell and caches each sport's assets on first play.
11. Warm-up inference runs behind the loading and calibration screen so the first real frame isn't slow.
12. Soak-test long sessions for memory growth; there are reports of GPU-delegate memory leaks in other MediaPipe tasks.

Two choices need measurements on Allen's hardware and wait for playtesting by Allen: Pose lite versus Pose full, and the WebGPU versus WebGL renderer. Until then use Pose lite and `WebGPURenderer` with its WebGL2 fallback, and keep both switchable by query flag (`?pose=full`, `?renderer=webgl`).

## Device gate

Runs once at load, before the menu:

1. Reject touch-first or small-viewport devices (phones, tablets) immediately.
2. Check capabilities: WebGL2, camera access via `getUserMedia`, Web Workers, and enough camera resolution.
3. Run a roughly two-second benchmark: warm-up inferences on a synthetic frame while rendering a representative scene, measuring median inference time and median render frame time **together**, since they contend for the GPU.
4. Pass, then one fixed configuration. Fail, then a warning screen ("This device may struggle", "Play anyway") with the measured numbers behind a "details" toggle; the player may continue and boot proceeds as on a pass. The warning is shown once per page session (`sessionStorage`), never for a merely `marginal` pass, and a missing camera API is a warning that leads into the camera-error / keyboard-and-mouse path. Only a missing WebGL 2 or Web Worker support stops the game with a terminal screen that says what is missing. The decision is `gateVerdict` in `src/core/gate/evaluate.ts`.

Pass thresholds are deliberately permissive, since the gate only warns about machines that struggle to play (software rendering, single-digit tracking). Tracking is judged by capacity, the median inference time (at most 66 ms, so 15 Hz or better), not by achieved rate, because many webcams deliver only 15 to 30 fps. Rendering is judged by the median frame time, at least 27 fps, so a vsync-capped or 30 Hz battery-saver display passes. The benchmark discards 10 warm-up inferences and the first 15 render frames, then samples for 3 s. A device below 20 Hz tracking or 40 fps rendering still passes, but `GateReport.marginal` is set. Thresholds live in `src/core/gate/thresholds.ts`. Provide a `?skipGate=1` query flag for development and for the headless checks, where software rendering would otherwise fail the gate.

## Scores

- Scores: IndexedDB per sport (personal best and history) from the first sport onward.
- Later: a global leaderboard on a Cloudflare Worker with D1. A browser game can't be made cheat-proof, so apply per-sport plausibility caps, rate limiting, and where practical submit a compact input summary (release speed, angle, timing) and recompute the score server-side with the same deterministic function.

## Verification standards

- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass before any commit.
- Recognizers and filters have unit tests driven by recorded (or, until Allen supplies them, synthetic) landmark sequences.
- Physics and scoring functions are pure and deterministic, with unit tests.
- `pnpm build` succeeds, and the Playwright checks pass for every sport that exists.
- A builder's "done" always lists what it could not verify without a webcam; carry those items into the playtest checklist.
- Set up a GitHub Actions workflow that runs typecheck, lint and tests on push.
