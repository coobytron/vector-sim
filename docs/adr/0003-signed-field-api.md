# ADR 0003 — Signed environmental-field API

- Status: Accepted — P07
- Date: 2026-08-07
- Supersedes: nothing
- Related: [ENVIRONMENT-CONTRACT.md](../ENVIRONMENT-CONTRACT.md),
  [SIMULATION-CONTRACT.md](../SIMULATION-CONTRACT.md),
  [P07-FIELD-API.md](../P07-FIELD-API.md)

## Context

P01 fixed the semantics of signed environmental influence: `+1` feeds, `0` is
neutral, `-1` kills, food and kill never cancel, and the combination rule must be
order-independent. It deliberately left the implementation open — the JSON schema
and query API were assigned to this issue.

The implementation had to satisfy several constraints at once:

- one API for Home, Forest, and Pond, with no environment-specific fork;
- deterministic to the float32 tick hash, independent of declaration order;
- cheap enough to sample the full population every tick inside the P02 budget
  (≤4 ms desktop tick at 8×256, ≤8 ms mobile at 4×128);
- headless, because the simulation tick may not touch Three.js or the DOM;
- editable at runtime, because #14 paints fields live.

## Decision

**Typed channels on stable-ID sources, sampled through a dense uniform grid, with
an analytic gradient.**

1. **Channels stay separate.** `effect`, `obstacle`, `shelter`, `habitat`, and
   `flow` are independent on one source. Nothing is inferred from mesh names,
   materials, colours, or file paths.
2. **Stable source ID is the evaluation order.** Sources sort by ID at load and
   the index returns candidates in ascending order, so manifest declaration order
   cannot change a sample or a hash.
3. **Saturating union per sign.** `F` and `K` accumulate as
   `1 - Π(1 - aᵢ)` separately, in float32, and only ever meet as the context
   value `E = F - K`.
4. **Dense uniform grid, not a hash grid or BVH.** Environment bounds are small
   and authored, so a dense grid gives exact single-cell lookups with no hash
   collisions. Moving a source re-buckets that source alone.
5. **Analytic gradient.** The falloff derivative is assembled from the terms the
   union already computes. The contract's 1 cm central difference is retained as
   the reference implementation and the test oracle.
6. **Finite reserves are opt-in.** A source without `reserve` is unlimited; one
   with a reserve depletes and regenerates deterministically.

## Alternatives considered

**Baked voxel field.** Sampling would be a texture fetch, and it would port
directly to a GPU path. Rejected for the MVP: it quantizes exactly the boundary
behaviour the contract is strict about, it makes moving and painted sources a
re-bake, and a resolution fine enough for 0.3 m ranges costs more memory than the
whole reference state budget. It stays open as a later optimization behind the
same API.

**Six-probe central-difference gradient everywhere.** Simplest and obviously
correct, but it multiplies the per-cell cost by seven and measured 2.3 ms per
mobile tick — over the desktop budget once scaled. The analytic path measures the
same values to within test tolerance at a fraction of the cost.

**Hash-grid spatial index.** Would handle unbounded worlds, but the environments
are bounded by manifest, and a hash risks silent collisions that would corrupt
sampled values in a way tests could easily miss.

**Signed distance fields per source evaluated on the GPU.** Deferred to the same
future work as the voxel path; the reference implementation must stay headless and
deterministic first.

## Consequences

- Sampling the full desktop population costs ~0.5 ms per tick on the P07
  container, leaving the tick inside its P02 budget.
- Any environment is authored data. Forest and Pond required no new runtime code,
  which is the adaptation gate P10 and P11 have to clear.
- Flipping a source's sign at runtime reverses its effect with no agent-side
  change, which is directly asserted in the metabolism tests.
- The manifests ship with empty `assets` while the environments are procedural.
  P09/P10/P11 must add checksummed asset entries; validation already fails a
  malformed or mismatched digest.
- The repair gate in the reference metabolism is a documented placeholder until
  P06 supplies the decoded model output.
