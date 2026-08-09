# Jolt spatial-query spike

Tracking: #37

## Decision under test

Use JoltPhysics.js only as an optional geometry/spatial-query adapter for collision, ray/shape queries, trigger volumes, contact points, and surface normals.

Vector Sim continues to own NCA behavior, morphology motion, lifecycle, continuous scalar/vector fields, rendering, fixed stepping, and replay semantics.

## Landed boundary

`src/physics/types.ts` defines the runtime-neutral contract. Jolt-specific objects must not cross this boundary.

`src/physics/normalizeObservations.ts` converts backend query results into deterministic simulation input order using stable source IDs and sanitized finite coordinates.

`src/physics/nullSpatialQueryWorld.ts` preserves a dependency-free fallback for headless tests, capture, and environments that do not need geometry queries.

## Jolt implementation rules

- Start with the single-threaded `jolt-physics/wasm` entrypoint.
- Load the separate WASM asset through Vite's `?url` mechanism.
- Use a small proxy per organism, not one rigid body per NCA cell.
- Environment geometry may use static box/convex/mesh/height-field bodies as appropriate.
- Trigger volumes and ray/shape queries are converted into `SpatialObservation` records.
- Stable source/body IDs are assigned by Vector Sim rather than relying on callback order.
- All Jolt allocations are owned and destroyed by the adapter.
- No Jolt API types are exposed to NCA, lifecycle, field providers, renderer, or serialized state.

## Promotion gate

Do not add Jolt to the production dependency graph until the adapter measures:

- WASM cold initialization time
- transferred WASM size
- memory delta
- physics/query p50 and p95
- total frame cost on desktop and mobile tiers
- repeated-run state-hash behavior

Reject the integration if single-threaded WASM cannot fit the mobile budget, replay cannot be normalized acceptably, or organism motion becomes rigid-body dominated.
