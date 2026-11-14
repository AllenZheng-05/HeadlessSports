# Design: the Field Day theme

## Overview

The feeling is a school sports day rendered in soft plastic: sunny, pastel, toy-like. It should evoke the motion-sports genre without copying Nintendo's logo, characters, typefaces or music.

## Palette

| Name | Hex | Use |
|---|---|---|
| Sky | `#BFE3F7` | Sky and backdrops |
| Turf | `#8FD694` | Ground; lighter hills `#A9E0AC`; blob shadows on turf `#6FBF7A` |
| Chalk | `#FBF8F1` | UI surfaces, field lines |
| Putty | `#F4F1EA` | The athlete's body |
| Whistle | `#FF7A59` | Player colour (mitts and feet), primary buttons |
| Ink | `#27364A` | Text; secondary text `#4A5A70` |

Each venue is built from Sky, Turf and Chalk plus **one accent of its own**. Proposed starting accents: climbing wall clay `#F2A07B`, bowling lane maple `#F0D29A`, archery straw `#F6D55C`, javelin track brick `#E8785A`.

## Athlete

Built procedurally from capsules and spheres in a bone-like `Object3D` hierarchy: pelvis, torso, upper arms, forearms, mitten hands, thighs, shins, feet. About 12 meshes, no head, no face, no rig file. The body is Putty; **only the mitts and feet carry the player colour**, because the mitts are what the player watches. The mitts visibly curl into a ball when a fist is detected and flatten when open.

**Driving the athlete.** A hybrid: the upper body mirrors the player live (shoulder and elbow angles from filtered 2D landmarks through a two-bone analytic IK solve, mirrored so the player's left hand moves the on-screen left hand); the lower body and big moments are procedural clips that gestures trigger and parameterise (run cycle driven by knee-lift cadence, follow-throughs, celebrations, climbing sway).

## 3D style

`MeshToonMaterial` with a three-step gradient map, one hemisphere light plus one directional light, flat vertex colours, blob shadows (a soft dark disc under the athlete, balls and pins), a sky-gradient background with distance fog, rounded capsule-like forms everywhere.

## Interface

The player stands about two metres from the screen, so every screen has a few very large elements, high-contrast Ink on Chalk, and pill-shaped buttons. Menus are navigable **by hand** (a hand cursor with hold-to-select) and by mouse and keyboard. Keep a small rounded mirror view of the camera with the skeleton overlay in a corner during play.

## Type

Fredoka for the wordmark, headings and scores; Nunito for body copy. Self-host both (for example via `@fontsource`). Use tabular numerals for scores.

## Motion and sound

Squash-and-stretch on impacts, bouncy easing on menus, short soft chimes for feedback. Original sounds only.

## Logo

The headless athlete with one fist raised (which is also the "start" gesture). Wordmark "Headless Sports" in Fredoka.

## Copy tone

Short, friendly, plain. Sentence case. Example: "Step back, raise a fist, and play. Your camera feed never leaves this device."

## Onboarding, privacy and safety

- Ask for the camera only after the player clicks Start, and before the browser prompt say plainly that video is processed on this device and never uploaded. Back that with a strict Content-Security-Policy (`connect-src` limited to our own origin). Show a camera-on indicator and a one-click camera-off control. Handle denial with per-browser instructions.
- Calibration: a silhouette guide ("step back until your whole body is inside the outline"; for climbing, "sit or stand close with both hands in view"), a lighting check with a hint if it's too dark, handedness chosen by raising the throwing hand, and a quick pose capture to measure shoulder width and arm length for normalisation.
- If the player drifts out of frame, pause and show a large arrow telling them which way to move.
- Safety: a "clear a 2 by 2 metre space" reminder before swinging and throwing sports. Short rounds with rest prompts; arm fatigue is a known problem for mid-air gesture games.
- Accessibility: left-handed support everywhere, seated options where the sport allows it (climbing, archery, darts), colour-blind-safe UI, and all menus usable by mouse and keyboard as well as by hand.
