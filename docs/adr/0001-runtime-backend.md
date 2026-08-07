# ADR 0001: Headless reference plus WebGL2 presentation

- Status: Accepted for P02
- Date: 2026-08-07
- Decision owners: implementation owner; creative owner approves reference tiers
- Resolves: D010 and D011

## Context

Spectral Homestead needs deterministic sparse graph updates, a learned local
fixture, headless tests, dynamic vector geometry, mobile compatibility, and a
static deployment. A dense world-grid backend would make the graph organism
secondary to its storage texture and would complicate stable topology IDs.

## Decision

Use a hybrid with two explicit boundaries:

1. A typed-array CPU runtime is the P02 semantic reference, deterministic oracle,
   and fallback for small fixtures.
2. Three.js on WebGL2 renders instanced nodes, dynamic line edges, and indexed
   ribbons from immutable-per-frame snapshots.

WebGPU compute remains a progressive adapter after P05 produces trained weights.
It may accelerate the same channel/update contract but cannot become a silent
requirement. WASM is an optimization of the CPU reference ABI, not a separate
simulation, and is added only if physical mobile evidence misses budget.

WebGL2 ping-pong and transform feedback remain measured throughput probes. They
are not selected as state truth because dynamic graph neighborhood gathering,
stable birth/retraction resolution, and headless replay would require parallel
implementations with higher drift risk.

## Consequences

- Tests can construct and advance simulation without `document`, canvas, or
  Three.js.
- Camera, renderer, and quality-presentation changes cannot alter hashes.
- A browser without WebGL2 receives a clear headless compatibility result.
- P05/P06 may add WebGPU or WASM adapters only behind parity fixtures and the same
  versioned model/state schema.
- Physical Safari captures are still required before issue #3 is complete.

## Reference tiers

- Desktop: MacBook Pro, M1 Max, 32 GB, Safari 26.x, 1920×1080.
- Mobile: iPhone 16 Pro, iOS 26.5.2 Mobile Safari, 1280 px long-edge cap.

Changing a baseline requires a decision-log amendment and does not rewrite old
benchmark evidence.
