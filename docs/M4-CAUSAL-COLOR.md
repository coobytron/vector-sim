# M4 — Causal color, replay, export

Open `/?ncaHome` (seed 1) or `/?ncaHome=<seed>`. The M3 Home route now shows
colour only when something happens to the organism. It also has Pause, Replay,
Export state, Import state and PNG export buttons.

## Causal emission

`src/homeSim/homeEmission.ts` computes emission as a pure function of the world
on the current tick:

| Event | Trigger | Colour | Where |
| --- | --- | --- | --- |
| Feeding | Lifecycle reports intake this tick | Blue (`feeding`, 470 nm side) | Nodes reading food within 0.25 m of the node the food touches, plus a line and travelling beads from the source contact to that node |
| Damage | Lifecycle reports damage this tick | Red (`damage`, 620 nm side) | Nodes reading kill within 0.25 m of the kill contact node, plus a line and beads from the source |
| Lesion | A node destroyed by kill exposure | Red flash, 0.35 s | That node |
| Regeneration | A lesioned node grows back | Blue-green flash, 0.8 s | That node |

The world is white, so the route paints emission over it with normal blending.
Additive glow would vanish against white. Each lit node shows its event hue at
full value, with coverage that rises with strength.

## Replay and state export

`HomeWorld.inputs` records the goal timeline, starting with the initial goal at
tick 0. `replayHomeWorld(model, preset, seed, inputs, tick)` rebuilds the world
exactly from that timeline.

`exportHomeState` writes `vector-sim.home-state.v1` JSON with these fields:
- model fingerprint
- preset id
- seed
- tick
- input timeline
- look
- camera position, target and fov
- determinism hash

`restoreHomeState` validates the file, replays it, and refuses the file if the
replayed hash differs from the saved one. Organisms and environment are restored
by replay, not by storing NCA tensors. A restored world keeps running in
lockstep with the original.

## PNG export

The route renders the current frame offscreen at 1920×1080 or 3840×2160
(clamped to 3840×2160). It uses the same scene and camera without the HUD or
buttons. `window.__ncaHome.exportPng(w, h)` returns the PNG data URL for
automation.

## Evidence

Automated in `tests/homeEmission.test.ts` and `tests/homeReplay.test.ts`:

- **No emission without an event.** Over more than 500 idle frames across all
  four goals, zero nodes are lit and no lines are drawn.
- **Feeding is blue from the threshold and damage is red from the outlet.** Each
  carries the source id of the real contact.
- **Every lit node is within the event path or a 0.25 m halo.**
- **Lesion and regrowth flashes land on the affected nodes.**
- **Replay gives identical hashes at ticks 0, 300 and 900.** This holds for a
  timeline with four goal changes.
- **Export → JSON → restore gives the same world, look and camera.** Tampered
  hashes, unknown presets, out-of-order inputs and other weights are rejected.

Checked in headless Chromium (SwiftShader) on the built route:

| Check | Result |
| --- | --- |
| Neutral idle frame, share of pixels with HSV saturation ≤ 0.12 | 100% (target ≥ 95%) |
| Feeding frame, authored camera | 99.98% neutral |
| 3840×2160 PNG exported twice | Byte-identical |
| 3840×2160 PNG after export state → fresh page → import | Byte-identical, same hash |

PNG determinism is shown for one machine and GPU path. Cross-GPU and
cross-browser pixel equality is not claimed.

## Still open

- **The five-second uncaptioned readability test needs a human reviewer.** From
  a camera framing the organism and source, feeding (blue line from the floor
  threshold) and damage (red line from the wall outlet) read clearly. From the
  authored wide orbit camera the organism is small and the colour is only a few
  pixels.
- **Only the Porcelain look is wired.** The state records the look, but the
  route renders Porcelain only.
- **Inputs are goal changes.** Camera moves are saved in the state but are not
  part of the replay timeline.
