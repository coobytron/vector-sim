# P14b — Jolt WASM adapter and measurement harness

Implementation of issue #39, on top of the backend-neutral spatial-query
boundary established in PR #38. Findings feed the P14 decision in #37.

**Recommendation: adopt**, behind the adapter, for geometry-derived queries
only. Every pass criterion is met and no kill criterion is triggered. The one
caveat is device hardware — see [What is still unmeasured](#what-is-still-unmeasured).

## What this is

Jolt as an **optional geometry intelligence layer**: collision surfaces, trigger
volumes, ray queries, and contact sensing. Not a replacement for the graph-NCA,
the morphology solver, the lifecycle core, or the field-provider API.

| File | Responsibility | Owner |
|---|---|---|
| `src/physics/types.ts` | Backend-neutral contract. | PR #38 |
| `src/physics/normalizeObservations.ts` | Deterministic ordering + sanitisation. | PR #38 |
| `src/physics/nullSpatialQueryWorld.ts` | Dependency-free fallback. | PR #38 |
| `src/physics/joltSpatialQueryWorld.ts` | **The only module naming Jolt.** | P14b |
| `src/physics/joltLoader.ts` | Single-threaded WASM loading. | P14b |
| `src/physics/joltSpikeFlag.ts` / `joltSpikeRoute.ts` | Opt-in `?spike=jolt` route. | P14b |
| `src/physics/porcelainScene.ts` | Static test geometry, pure data. | P14b |
| `scripts/benchmark-jolt.ts` | Node harness (`npm run benchmark:jolt`). | P14b |

## Design decisions that carry the risk

**Proxies are kinematic, not dynamic.** The NCA owns motion;
`setProxyPosition` teleports the proxy each tick. Jolt integrates nothing that
is rendered, so no integrator output can enter simulation state and motion
cannot start reading as rigid-body dynamics. Physics answers questions; it does
not move anything that matters.

**Three object layers.** Obstacles, organism proxies, and sensor volumes each
get their own layer. This was not cosmetic — before the split, two real bugs
appeared: an obstacle probe hit *the proxy casting it* (reported distance always
zero), and a sensor volume swallowed a downward ray so the floor was never
found. Both are regression-tested.

**Proxy management is not on the shared interface.** `SpatialQueryWorld` from
PR #38 stays exactly as authored; `addProxy` / `observeProxy` / `stateHash` are
Jolt-class methods. Callers that only need the boundary never see them.

## Determinism

Mitigations: no engine handle escapes (bodies register against authored string
IDs); bodies are *created* in sorted authored-ID order so engine indices follow
the scene rather than caller array order; every result passes through
`normalizeSpatialObservations`; and kinematic proxies mean no integration result
feeds back into simulation state.

Measured:

| Check | Result |
|---|---|
| 3 repeat runs, 120-frame scripted path (Node) | identical — `8101103e` |
| 3 repeat runs (headless Chromium) | identical — `8101103e` |
| Reversed scene declaration order | byte-identical observations and hash |

Node and Chromium producing the **same** hash on the same architecture is a
better result than expected, and it follows from the design: the hash covers
proxy positions the caller set, and query answers are sorted and sanitised.

**Still unproven: cross-*architecture* determinism.** Both runtimes here were
x64 with the same WASM build. Jolt gives no bit-exact cross-platform guarantee,
so replay across machines must not be claimed until measured on arm64.

## Measurements

### Browser — headless Chromium 141, 1280×720, DPR 1

`benchmark-results/p14b-jolt-browser-2026-08-09.json`, captured via
`?spike=jolt` against `vite preview`.

| Metric | Desktop tier (8 proxies) | Mobile tier (4 proxies) |
|---|---:|---:|
| WASM cold init (fetch + compile + world) | **145.7 ms** | — |
| WASM transferred | **2,021,869 bytes** (uncompressed) | — |
| Physics step p95 | 0.100 ms | 0.100 ms |
| Query + sensor p95 | 1.200 ms | 0.600 ms |
| **Total p95** | **1.305 ms** | **0.600 ms** |
| Budget / headroom at p95 | 16.67 ms / **15.36 ms** | 33.33 ms / **32.73 ms** |

Chromium clamps `performance.now()` to 0.1 ms, so these are quantised — treat
0.100 ms as "at or below one tick of timer resolution", not a precise figure.

### Node — Linux x64, Xeon @ 2.80 GHz

`benchmark-results/p14-jolt-2026-08-09.json`. Includes the headless simulation
in the frame so the physics cost can be read in context.

| Metric | Desktop tier | Mobile tier |
|---|---:|---:|
| WASM cold init | 109 ms | 86 ms (module already compiled in-process) |
| RSS delta | 20.8 MB | — |
| Physics step p50 / p95 | 0.052 / 0.092 ms | 0.036 / 0.055 ms |
| Query + sensor p50 / p95 | 0.814 / 1.471 ms | 0.420 / 0.791 ms |
| Simulation + physics total p95 | 6.441 ms | 2.520 ms |
| Headroom at p95 | 10.23 ms | 30.81 ms |

Module on disk: `jolt-physics.wasm.wasm` 1.93 MB, glue 0.92 MB. The npm package
unpacks to ~46 MB because it ships every build variant.

Reading these honestly: **the physics step is free** — static geometry plus
kinematic proxies leaves Jolt almost nothing to integrate. **Queries dominate
and are still cheap**, roughly 7 µs each. The real cost is the ~2 MB download.

## Vite integration

The obvious approach — `import wasmUrl from 'jolt-physics/dist/jolt-physics.wasm.wasm?url'`
— **does not work**. The package's `exports` map has no `./dist/*` entry, so
bundler resolution fails:

```text
"./dist/jolt-physics.wasm.wasm" is not exported under the conditions
["module", "browser", "production", "import"]
```

It turns out no `locateFile` is needed at all: Vite/rolldown follows the glue's
own internal reference and emits the `.wasm` as a hashed asset
(`jolt-physics.wasm-CvlHROwB.wasm`), rewriting the URL correctly. Verified in a
real browser. An earlier iteration staged the file into `public/` to work around
the exports map; that was removed once the bundler path was confirmed.

## Opt-in route

`?spike=jolt` runs the measurement harness and renders the JSON. Everything
Jolt-related is behind dynamic imports, and the flag itself lives in a separate
module so the static import in `main.ts` does not drag the route into the
default chunk.

Verified in the browser: the default route **fetches no `.wasm` at all** and
mounts its canvas normally. Default bundle 646.42 kB versus 644.69 kB before —
the +1.73 kB is the flag check, not the engine.

## Pass criteria (#39)

- [x] `JoltSpatialQueryWorld` satisfies the PR #38 contract.
- [x] Single-threaded Jolt WASM loads under Vite — verified in Chromium.
- [x] Static environment collision/query geometry works in the browser.
- [x] A Jolt-derived observation is visible in benchmark output
      (`sampleObservation`, a `ray-hit` on `floor` with point and normal).
- [x] All observations pass through deterministic normalization.
- [x] Adapter cleanup explicitly destroys owned Jolt/WASM objects; `dispose()`
      is idempotent and later queries throw.
- [x] `npm run qa` green.
- [x] Startup/query/frame costs documented for both tiers.
- [x] Findings posted back to #37.

## What is still unmeasured

**The D011 baseline devices.** Everything here ran in a Linux container —
headless Chromium and Node, not MacBook Pro M1 Max / Safari 26.x and not
iPhone 16 Pro / Mobile Safari. Specifically open:

- Safari's WASM compile behaviour, which differs from V8's,
- real transfer time over a mobile network (2 MB uncompressed; gzip/brotli on a
  real host should cut this substantially, and was not exercised by
  `vite preview`),
- interaction with actual rendering, since nothing was drawn during these runs,
- on-device memory pressure against the P02 mobile budget.

The headroom is wide — 32.7 ms of a 33.3 ms mobile budget — so I would be
surprised by a failure. But that is a prediction, not a measurement, and the
download size is the part least likely to be forgiving.

`jsHeapDeltaBytes` in the browser report is unreliable (it captures GC noise
around module instantiation); use the Node RSS figure instead.

## Deferred

- Trigger containment is an overlap test against a small sphere at the proxy
  centre. True volume-overlap semantics would need a full `CollideShape` pass.
- Contact sensing is six axis-aligned probe rays, not a contact manifold.
  Adequate for obstacle proximity and ground state; tight navigation would want
  swept or shape-cast queries.
- No Jolt body per NCA cell, no soft bodies, no fluid, no multithreaded WASM —
  all explicitly out of scope.
- The adapter is not wired into the simulation loop; only the opt-in route uses
  it.

## Commands

```bash
npm run test -- tests/spatialWorld.test.ts   # adapter + determinism
npm run benchmark:jolt                       # Node measurements
npm run build && npm run preview             # then open /?spike=jolt
```
