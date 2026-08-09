# P14 — Jolt WASM spatial-query evaluation

Spike for issue #37. Evaluates `jrouwe/JoltPhysics.js` as an **optional geometry
intelligence layer**: collision surfaces, trigger volumes, ray queries, and
contact sensing — never as a replacement for the graph-NCA, the morphology
solver, the lifecycle core, or the field-provider API.

**Recommendation: conditional keep.** Jolt is cheap, deterministic enough for
our usage pattern, and stays fully contained behind an adapter. One measurement
gate remains before committing it to the production architecture — see
[Open gate](#open-gate).

## Architecture as built

```text
NCA / lifecycle / fields          renderer
          │                          │
          ▼                          │
   SpatialQueryWorld  ◄──────────────┘  (never sees Jolt)
     ├── createNullSpatialWorld       physics disabled
     └── createJoltSpatialWorld       the only module naming Jolt
```

| File | Responsibility |
|---|---|
| `src/physics/types.ts` | `SpatialQueryWorld` contract, scene descriptors, validation. |
| `src/physics/nullWorld.ts` | Adapter-disabled world; senses nothing, stays operational. |
| `src/physics/joltWorld.ts` | **The only file that names Jolt.** |
| `src/physics/joltLoader.ts` | Single-threaded WASM loading, `locateFile` seam. |
| `src/physics/joltViteAsset.ts` | Browser-only Vite `?url` asset path. |
| `src/physics/porcelainScene.ts` | Static porcelain test environment, pure data. |
| `src/physics/spatialProvider.ts` | Bridges observations into the #8 `FieldProvider` contract. |

Two decisions carry most of the risk reduction:

**Proxies are kinematic, not dynamic.** The NCA owns organism motion;
`setProxyPosition` teleports the proxy each tick. Jolt therefore never
integrates organism movement, which is what keeps motion from reading as
rigid-body dynamics and keeps integrator results out of simulation state.
Physics answers questions; it does not move anything that matters.

**Object layers separate the three concerns.** Obstacles, organism proxies, and
sensor volumes each get their own object layer, so an obstacle ray never hits a
proxy (including the one casting it) and never terminates on a sensor, and
trigger containment never reports an obstacle. Both bugs showed up in testing
before the layers were split.

## Determinism

Jolt is not assumed to be deterministic. The mitigations:

- **No engine handle escapes.** Bodies are registered against authored string
  IDs; `BodyID` indices are internal. Bodies are also *created* in sorted
  authored-ID order, so engine indices are a function of the scene rather than
  of caller array order.
- **Every result list is stable-sorted** by authored source ID before it leaves
  the adapter.
- **Query outputs are float32-quantized** through the same `vec3`/`f32` helpers
  the field kernel uses.
- **No integration feedback.** Kinematic proxies mean no Jolt-computed velocity
  or position ever enters the simulation hash — only query answers do.

Measured: three repeat runs of a 120-frame scripted path produce an identical
`stateHash` (`8101103e`), and a scene declared in reverse order produces
byte-identical observations and hash. Both are covered in
`tests/spatialWorld.test.ts`.

**Not verified:** cross-platform and cross-build determinism. Everything here
ran on one Linux x64 build of Jolt 1.1.0. Jolt makes no cross-platform bit-exact
guarantee by default, so a different CPU or a rebuilt WASM could differ in the
last bits of a ray fraction. This matters less than it normally would because of
the no-integration-feedback property above, but replay across machines must not
be claimed until it is measured.

## Measurements

Captured by `npm run benchmark:jolt` →
`benchmark-results/p14-jolt-2026-08-09.json`.

Host: Linux x64, Intel Xeon @ 2.80 GHz, 4 cores, Node v22. Jolt 1.1.0,
single-threaded WASM. 180 sampled frames after 30 warmup frames.

| Metric | Desktop tier (8 organisms) | Mobile tier (4 organisms) |
|---|---:|---:|
| WASM cold init | **96.2 ms** | 27.1 ms (module already compiled in-process) |
| RSS delta | 18.9 MB | 4.3 MB |
| Physics step p50 / p95 | 0.053 / 0.088 ms | 0.031 / 0.062 ms |
| Query + sensor p50 / p95 | 0.386 / 0.729 ms | 0.196 / 0.370 ms |
| Simulation p50 / p95 | 4.063 / 5.089 ms | 1.019 / 1.164 ms |
| **Total frame p50 / p95** | **4.549 / 5.514 ms** | **1.256 / 1.553 ms** |
| Frame budget | 16.67 ms | 33.33 ms |
| Headroom at p95 | 11.15 ms | 31.78 ms |

Module size, single-threaded build:

| Asset | Bytes |
|---|---:|
| `jolt-physics.wasm.wasm` | 2,021,569 (1.93 MB) |
| `jolt-physics.wasm.js` glue | 964,712 (0.92 MB) |
| npm package unpacked | ~46 MB (all build variants) |

Reading these honestly:

- **The physics step is free.** 0.05 ms at desktop tier is noise against a
  16.67 ms budget. Static geometry plus kinematic proxies means Jolt has almost
  nothing to integrate.
- **Queries dominate the physics cost and are still cheap.** 8 organisms × 6
  probe rays + 8 trigger queries = 56 queries in 0.386 ms, roughly 7 µs each.
- **Only the first init pays full cold cost.** The mobile tier's 27 ms reflects
  an already-compiled module in the same process; 96 ms is the honest
  cold-start figure, and a browser will additionally pay ~2.9 MB of transfer.
- **Bundle impact today is zero.** The adapter is not wired into the app, and
  the production bundle is byte-identical at 644.69 kB.

## Pass criteria

- [x] Jolt fully hidden behind an internal adapter — one file names it, and a
      test asserts only string IDs cross the boundary.
- [x] Home-style static collision and trigger volumes work with no
      environment-specific organism code.
- [x] A ray-derived observation reaches an organism through the shared
      `FieldProvider` contract (`obstacleDistance`, `grounded`, `groundNormal`,
      `obstacleDirection`).
- [x] Observations normalized into deterministic ordering before state updates.
- [x] Organism motion cannot be dominated by rigid-body dynamics — proxies are
      kinematic and the NCA remains the only mover.
- [x] Disabling the adapter leaves the headless simulation operational
      (`createNullSpatialWorld`, covered by tests).
- [x] Single-threaded WASM meets the provisional mobile CPU budget, with
      31.78 ms of headroom at p95 — **CPU-side only, see the open gate**.
- [x] Memory and startup costs documented above.
- [x] Repeat-run `stateHash()` documented; identical within a build.
- [x] The adapter takes a scene descriptor, so Home, Forest, and Pond reuse it
      without scene-specific forks.

## Kill criteria

| Criterion | Verdict |
|---|---|
| Materially destabilizes deterministic replay | **Not triggered.** Kinematic proxies keep integrator output out of simulation state; queries are sorted and quantized. Cross-platform remains unproven. |
| Unacceptable mobile startup or memory pressure | **Not triggered on CPU/memory** (4.3 MB RSS). Transfer size is the real cost and is unmeasured on device. |
| Mobile targets need multithreaded WASM | **Not triggered.** Single-threaded has 31.78 ms of headroom at p95. |
| Jolt types leak into NCA/field/lifecycle/renderer | **Not triggered.** One file imports Jolt. |
| Motion dominated by rigid-body dynamics | **Not triggered.** Jolt integrates nothing that is rendered. |
| Duplicates the field-provider system | **Not triggered.** It feeds that system as another provider. |

## Open gate

The one number I could not produce here: **device-class browser performance on
the D011 baselines** (MacBook Pro M1 Max / Safari 26.x, and iPhone 16 Pro /
Mobile Safari). This spike ran in Node on a 4-core Xeon container. What that
leaves unmeasured:

- real WASM transfer and compile time over a mobile network,
- Safari's WASM compilation behaviour specifically,
- GPU/render interaction, since nothing was rendered here,
- memory pressure on a real device against the P02 mobile budget.

The CPU-side headroom is large enough that I would be surprised by a failure,
but "surprised" is not "measured". Before Jolt is committed to the production
architecture, the browser benchmark route should load the adapter and capture
init, transfer, and frame cost on both baselines.

## Deferred and out of scope

- No Jolt rigid body per NCA cell; one proxy per organism, as specified.
- No soft-body organisms, no fluid, no multithreaded WASM.
- Trigger containment is a point test against the proxy centre. Volume-overlap
  semantics (proxy partially inside) would need `CollideShape` instead.
- Contact sensing is six axis-aligned probe rays, not a true contact manifold.
  Adequate for obstacle proximity and ground state; a swept or shape-cast query
  would be needed for tight navigation.
- The adapter is not wired into the running app. That is a deliberate scope
  boundary for a spike — it keeps the bundle unchanged and the kill decision
  cheap.

## Commands

```bash
npm run test -- tests/spatialWorld.test.ts   # 19 tests, incl. determinism
npm run benchmark:jolt                       # regenerate the measurements
npm run qa
```
