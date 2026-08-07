# P07 — Signed environmental-field API

Every architectural or natural feature influences organisms through one API.
A wall, window, outlet, table, tree, flower, drain, current, or invisible region
nourishes, stays neutral, or damages without a single line of organism-specific
scene code. This document describes the implementation of the semantics fixed in
[ENVIRONMENT-CONTRACT.md](ENVIRONMENT-CONTRACT.md).

## Module map

| File | Responsibility |
|---|---|
| `src/fields/types.ts` | Manifest, channel, and sample types; the batch layout |
| `src/fields/shapes.ts` | Point, sphere, box, capsule/path, plane, and mesh adapters |
| `src/fields/spatialIndex.ts` | Dense uniform grid over the authored bounds |
| `src/fields/fieldSampler.ts` | The query API, combination rules, and runtime edits |
| `src/fields/manifest.ts` | Strict validation and `loadEnvironment` |
| `src/environments/manifests/*` | Home, Forest, and Pond authored manifests |
| `src/rendering/fieldDebugScene.ts` | Debug rendering of sign, falloff, range, direction |
| `src/ui/fieldPanel.ts` | Source legend, live probe, and sign-flip control |

The field API is sampled inside the headless tick, so `src/fields` and
`src/environments/manifests` carry the same headless boundary as
`src/simulation`: no Three.js, no DOM. `npm run validate:p07` enforces it.

## Channels

A source owns any combination of independent channels. A food threshold can also
be an obstacle; a sheltered alcove can also carry habitat. Because channels stay
separate, these combinations are explicit rather than inferred.

| Channel | Stored value | Meaning |
|---|---|---|
| `effect` | signed strength `[-1,1]` + range `m` | `+1 food` restores energy, `-1 kill` damages health |
| `obstacle` | boolean | Collision and navigation only; never metabolic |
| `shelter` | `[0,1]` | Reduces idle drain by up to 40% |
| `habitat` | 3 × `[0,1]` | Conditions phenotype behaviour; no metabolism |
| `flow` | vector `m/s` | Transports cells; no metabolism |

`auxiliaryRangeMeters` gives shelter, habitat, and flow a falloff range. Omitted,
those channels use volume containment: full value inside the authored volume and
nothing outside it.

## Combination rules

Each source contributes with the contract's smootherstep falloff, evaluated in
float32:

```text
uᵢ = clamp(1 - dᵢ / rᵢ, 0, 1)
wᵢ = uᵢ³ × (uᵢ × (uᵢ × 6 - 15) + 10)
aᵢ = clamp(abs(sᵢ) × wᵢ, 0, 1)
```

`dᵢ` is the distance to the authored surface, clamped at zero, so anywhere inside
a volume reads as full exposure. Positive and negative contributions aggregate
separately with a saturating, commutative, order-independent union:

```text
F = 1 - product(1 - aᵢ) for sᵢ > 0
K = 1 - product(1 - aᵢ) for sᵢ < 0
E = clamp(F - K, -1, 1)
```

`F` and `K` enter metabolism independently: equal exposure feeds and damages at
the same time instead of cancelling. `E` exists only as learned directional
context and for inspection.

The remaining channels combine as the contract specifies:

- **Obstacle** — minimum signed distance, clamped to ±1 m; ties resolve to the
  lower source ID because the comparison is strict.
- **Shelter** — saturating union, clamped to `[0,1]`.
- **Habitat** — weighted average by falloff weight; zero weight yields `[0,0,0]`.
- **Flow** — weighted sum, then clamped to 1 m/s magnitude.

### Order independence

Sources are sorted by stable source ID at load, and the spatial index returns
candidates in ascending source order. Declaration order in a manifest therefore
never reaches a sampled value or a tick hash. `tests/fieldSampler.test.ts` and
`tests/fieldMetabolism.test.ts` assert this with reversed and shuffled manifests,
comparing whole samples and 120-tick state hashes.

## Gradient

The runtime gradient is **analytic**, assembled from the same per-source terms
the union already computes:

```text
∂F/∂x = (1 - F) × Σ_food [ (|sᵢ| × w'(dᵢ)) / (1 - aᵢ) ] × nᵢₓ
∂K/∂x = (1 - K) × Σ_kill [ … ]
∇E    = ∇F - ∇K,  w'(d) = -30u²(u-1)² / r
```

`nᵢ` is the outward normal at the closest surface point, which the sampler
already has. The contract's central-difference fallback at 1 cm remains available
as `sampleEffectGradientNumeric` and is the reference the analytic path is tested
against. Dropping the six extra probes per cell is what keeps sampling inside its
budget.

The reported gradient is a unit direction plus a magnitude normalized against
20 · m⁻¹.

## Contact points

Every sample reports the strongest effect contributor's source index, sign,
contact point, and contact normal, including for mesh-bound sources. That is what
lets emission originate at the surface an organism actually touched instead of at
an object's center.

## Spatial index

A dense uniform grid (0.5 m cells) covers the manifest bounds. Each source is
inserted into every cell its influence AABB overlaps, so a point query reads one
cell — no hashing, no collisions. Positions outside the bounds clamp to the
border cell, so influence reaching past the bounds is still found.

- `moveSource` and `setRange` re-bucket **one** source; the grid is never rebuilt
  for animation.
- `addSource` and `removeSource` rebuild the index, because indices shift.
- Batched sampling reuses the candidate list while consecutive cells stay in the
  same grid cell.

## Depletion and regeneration

An `effect.reserve` gives a source a finite capacity and a regeneration rate.
Effective strength scales by the remaining fraction, `drawReserve` withdraws what
a cell actually consumed, and `advance(dt)` regenerates once per tick. A drained
threshold stops feeding without any change to the organisms standing on it.

## Runtime editing (painting hooks for #14)

`setStrength`, `setRange`, `moveSource`, `addSource`, and `removeSource` retune
the live environment. Flipping a source's sign reverses its effect with no change
in agent code — the claim the whole contract rests on. The browser panel exposes
this directly.

## Spawn contract

`placeSpawn` draws candidates from a Halton sequence (bases 2/3/5), so placement
is deterministic and seed-stable. A candidate is accepted only when it is outside
every exclusion volume, has `K ≤ 0.05`, `F ≤ 0.10`, and at least 0.20 m of
obstacle clearance. A region that cannot satisfy the contract returns `undefined`
and the simulation raises a visible authoring error rather than drifting to an
unrelated region.

Manifest validation runs the same checks at load, so an unusable spawn region
fails before the first tick.

## Manifest validation

`validateEnvironmentManifest` fails visibly on every condition the environment
contract lists: unsupported schema version, duplicate stable IDs, out-of-range
channel values, non-positive effect range, missing or mismatched asset checksum,
a spawn region overlapping kill or lacking clearance, a camera preset without safe
bounds or fallback input, and a missing required look. `loadEnvironment` throws an
`EnvironmentManifestError` listing every failure at once.

The shipped manifests declare no assets while their environments are procedural
grayboxes; P09, P10, and P11 add checksummed asset entries with the authored
geometry.

## Home, Forest, and Pond

One query API serves all three. Forest and Pond add no channel:

| Environment | Food | Kill | Neutral | Other channels |
|---|---|---|---|---|
| Spectral Homestead | `threshold-feed` (depleting) | `fault-kill` | floor, walls, table | stair shelter, window habitat |
| Vector Canopy | `root-feed` (depleting) | `trunk-fault-kill` | terrain, trunk | crown habitat, hollow shelter |
| Prismatic Pond | `inlet-feed` (depleting) | `drain-kill` | basin | surface flow, reed shelter, shallows habitat |

## Simulation integration

`HeadlessSimulation` samples the whole population once per tick into a packed
float32 batch whose stride matches the environment rows of the perception table
in [SIMULATION-CONTRACT.md](SIMULATION-CONTRACT.md):

```text
food, kill, effect, gradientXYZ, gradientMagnitude,
obstacleDistance, obstacleNormalXYZ, shelter, habitatABC, flowXYZ   (18 floats)
```

Metabolism then follows the contract exactly:

```text
idleDrain = 0.012 × (1 - 0.40 × S)
energy'   = clamp(energy + 0.20×F×dt - idleDrain×dt - M, 0, 1)
repairOK  = energy' > 0.35 and K < 0.05
health'   = clamp(health - 0.35×K×dt + 0.08×R×repairOK×dt, 0, 1)
```

`M` is the motion cost, capped at 0.004 energy per tick. At `health = 0` the cell
deactivates and keeps its stable slot ID for later regrowth. Flow is added to
velocity before integration and never touches energy or health. A cell that
penetrates an obstacle is projected back out plus 1 mm with its inward normal
velocity removed at restitution 0.05, which cannot add kinetic energy.

The repair gate is currently derived from cell state as a documented placeholder;
P06 replaces it with the decoded model output.

## Debug view

Open `?fields=1` (optionally with `&environment=vector-canopy` or
`&environment=prismatic-pond`):

- **Sign** — 470 nm blue for food, 620 nm red for kill, through the P03 spectral
  pipeline.
- **Falloff** — lattice brightness follows the sampled magnitude.
- **Range** — the lattice stops where the source stops.
- **Source** — a wire proxy per source plus the panel legend and live probe.
- **Direction** — gradient arrows along the sampled net effect.

The panel lists every source with its channels and a **Flip sign** button, and
reports a live probe at the camera target. The inspector is a lazily imported
chunk, so a default run never downloads it.

## Measured cost

Sampling the full population is measured separately in the Node benchmark as
`fieldSampleMs` and committed in
`benchmark-results/node-field-sampling-2026-08-07.json`.

| Tier | Cells | Field batch median | Field batch P95 | Tick P95 | Tick budget |
|---|---:|---:|---:|---:|---:|
| Mobile | 512 | 0.133 ms | 0.263 ms | 0.923 ms | ≤8 ms |
| Desktop | 2048 | 0.522 ms | 0.684 ms | 3.756 ms | ≤4 ms |

Recorded on the P07 container (Intel Xeon @ 2.1 GHz, Node 24), which is slower
than the P02 reference host — the same reference simulation measures 3.563 ms per
desktop tick there against 2.095 ms in the committed P02 baseline. The field API
adds roughly 0.5 ms per desktop tick. Re-run `npm run benchmark:node` on the
D011 baseline hardware for numbers comparable to the P02 evidence.

Production bundle after P07: 173.0 KB gzip JavaScript plus 1.8 KB gzip CSS,
against the 200 KB budget.

## Tests

| File | Covers |
|---|---|
| `tests/fieldShapes.test.ts` | Every adapter: boundaries, interiors, normals, contact points, bounds, translation |
| `tests/fieldSampler.test.ts` | Falloff, saturating union, non-cancellation, order independence, obstacle minimum, shelter/habitat/flow rules, analytic vs numeric gradient, batching, depletion, runtime edits, spawn placement, exclusion |
| `tests/fieldManifest.test.ts` | Every documented validation failure, plus all three shipped manifests |
| `tests/fieldMetabolism.test.ts` | Neutral fields, feeding, simultaneous feed/damage, lethal threshold, sign reversal, shelter, reserve exhaustion, flow transport, collision resolution, hash order independence, tier parity |
| `tests/fieldBudget.test.ts` | Batch layout and the field query budget |
