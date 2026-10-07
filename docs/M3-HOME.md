# M3 — Home, one look

Open `/?ncaHome` (seed 1) or `/?ncaHome=<seed>` in the dev or preview build. The
M1 organism lives in the Courtyard House preset in the Porcelain look, seen from
the preset's authored orbit camera, with orbit, pinch and touch controls. Buttons
send it to the food threshold, the outlet fault or the under-stair shelter, or
make it stay. Reset restarts the same seed.

## What runs

- `src/homeSim/homeColliders.ts` replaces Jolt queries for Home with analytic box
  collision. Walls, stair steps, table legs, the yard edge and the outlet are
  disc-vs-box obstacles when they overlap the organism's height. The tabletop is
  above the organism, so it walks under the table. The floor bounds the walkable
  area. A 0.05 m grid with 8-connected Dijkstra gives the path to the current goal.
- `src/homeSim/homeWorld.ts` scales the Branching rest pose to 0.34 m tall
  (`HOME_ORGANISM_SCALE = 0.3`), which is small enough to reach the shelter under
  the stair. Each node reads the preset's shared field provider at its own position.
  `energy` feeds the trained F sensor and `danger` the K sensor, so food thickens
  and kill thins the organism locally. Nodes at `danger ≥ 0.4` are destroyed for
  the tick. Energy and health come from the existing lifecycle system, sampled
  at the living-node centroid. A dead organism is cleared and never regrows.
- Locomotion is hand-authored path following, not learned.

## Approval checklist: Environment and field behavior

Automated in `tests/homeWorld.test.ts`:

| Item | Evidence |
| --- | --- |
| Spawn: 0.20 m clearance, K ≤ 0.05, F ≤ 0.10 | Seeded spawn search; checked for five seeds at every node |
| Threshold produces food and raises energy | Energy rises at the threshold; the feed event names the switchable conduit |
| Fault produces kill and lowers health | Health falls; the damage event names the outlet hazard; only nodes in danger die |
| Food and kill together do not cancel | With a test food source over the fault, a tick gains energy and loses health |
| Neutral stair, table, boundaries only collide | Clearance never negative; pure idle drain and full health while passing them |
| Shelter cuts idle drain by 40% at full strength | Measured drain = baseline × (1 − 0.4 × 0.72); no feed event |
| Declaration order does not matter | Reversed sources and shelters give the same pinned hashes at ticks 0, 300, 900 |

Still open:

- **Recognizable white cutaway domestic volume** needs a human look at the route.
- **Habitat** is not implemented. The presets declare no habitat regions, and M1
  only ever saw the neutral habitat sensor value of 1.
- **No default colour from shelter** is now checked by M4's idle-emission test,
  which includes the shelter goal. See `docs/M4-CAUSAL-COLOR.md`.
