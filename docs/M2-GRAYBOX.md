# M2 — Graybox loop in the browser

Open `/?graybox` (seed 1) or `/?graybox=<seed>` in the dev or preview build.
Space pauses, `.` single-steps, `r` resets, drag to orbit.

## What runs

- `src/nca/graph/graphNcaRuntime.ts` loads `src/nca/models/branching-m1.weights.json`
  (the M1 CPU pilot, `vector-sim.graph-nca.v1`) and steps the 128-node Branching
  tree with plain loops. `tests/graphNcaRuntime.test.ts` reproduces the PyTorch
  golden frames at ticks 1, 8 and 32 within 1e-5.
- `src/graybox/grayboxWorld.ts` puts one organism in a 6 × 4 box room:
  a food doorway on the +x wall, a kill wall along +z and one neutral obstacle
  in the middle. The organism spawns as the single-node seed, grows in place,
  then heads for the doorway. Its detour around the obstacle brushes the kill
  wall, so part of the grown organism is destroyed. It then feeds at the doorway
  and the NCA regrows the lost nodes.
- `src/graybox/grayboxRoute.ts` draws it with debug lines only: gray structure,
  blue doorway, red kill wall, organism edges shaded by alive and thickness.

## How fields reach the organism

Only through the trained M1 sensors: F (food, ≥ 0) falls off linearly within
1.6 of the doorway opening and K (kill, ≤ 0) within 1.0 of the kill wall, both at
amplitude 0.8, inside the M1 training range. A node whose K reads below −0.4 is
zeroed each tick. Feeding adds energy in proportion to F summed over living nodes.

## Not learned

Locomotion is a hand-authored steering rule on the organism root, not part of the
NCA: wait until 60% of nodes are alive, head for the doorway, detour round the
obstacle's nearer corner, push out of collisions. The NCA only decides the
organism's shape, its field response and its regrowth.

## Exit test

`tests/grayboxWorld.test.ts`:

- Gate B: the events for seed 1 within 900 ticks are spawn → damage → feed → regrow.
  Damage removes at least 20% of a fully grown organism, the root never enters the
  obstacle or leaves the room, the state stays finite, and the organism ends fully
  regrown at the doorway with energy.
- Determinism: pinned state hashes for seed 1 at ticks 0, 300 and 900 (`6006da8b`,
  `f5ff3655`, `1cb16a10`), reproduced on repeat runs.

The hashes cover NCA state and the organism's body (position, heading, energy).
They are pinned under Node; browsers may differ in the last bit of `Math.sin`,
`Math.cos` and `Math.hypot`, so cross-browser hash equality has not been checked.
