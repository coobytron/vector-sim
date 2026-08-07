# Environment contract

This document defines how Home, Forest, Pond, and future environments communicate
with the shared simulation. Environment names and visual materials have no
behavioral meaning; manifests and typed fields do.

## Manifest boundary

Every environment provides a versioned manifest with:

- stable environment ID and display name;
- meters as the authoring unit and a right-handed +Y-up transform;
- world bounds and collision geometry;
- typed field sources with stable IDs;
- spawn regions and exclusion volumes;
- camera presets, including input capabilities;
- supported looks and per-look exposure overrides;
- quality-tier asset and simulation limits;
- asset checksums used by replay;
- environment-specific golden scenarios.

Manifest parsing is strict. Unknown required versions fail visibly; missing
optional channels use documented zero/default values. Runtime code may not infer
food or kill behavior from mesh names, colors, or file paths.

## Geometry roles and field channels

A geometry object can own multiple independent roles:

| Role/channel | Stored value | Simulation meaning |
|---|---|---|
| `neutral` | no metabolic field | Visible/collidable geometry only. |
| `effect` | signed strength `[-1,1]` | Positive creates food; negative creates kill. |
| `obstacle` | signed distance in `m` | Collision and navigation; no health/energy effect. |
| `shelter` | strength `[0,1]` | Reduces idle drain by up to 40%. |
| `habitat` | 3 values each `[0,1]` | Conditions phenotype behavior; no direct metabolism. |
| `flow` | vector in `m/s` | Transports cells; no direct metabolism. |
| `spawn` | oriented volume | Permitted initial transforms. |
| `exclusion` | oriented volume | Prevents spawn; not necessarily an obstacle. |

A food threshold can also be an obstacle; a sheltered region can also carry a
habitat value. Because channels remain separate, these combinations are explicit.

## Signed effect semantics

Each effect source has strength `sᵢ ∈ [-1,1]`, range `rᵢ > 0 m`, distance to its
authored surface/volume `dᵢ`, and smootherstep falloff:

```text
uᵢ = clamp(1 - dᵢ / rᵢ, 0, 1)
wᵢ = uᵢ³ × (uᵢ × (uᵢ × 6 - 15) + 10)
aᵢ = clamp(abs(sᵢ) × wᵢ, 0, 1)
```

Positive and negative contributions aggregate separately using a saturating,
commutative union:

```text
F = 1 - product(1 - aᵢ) for sources where sᵢ > 0
K = 1 - product(1 - aᵢ) for sources where sᵢ < 0
E = clamp(F - K, -1, 1)
```

Sources are evaluated in stable source-ID order with float32 operations. `F` and
`K` are retained and enter metabolism independently. `E` is supplied for learned
directional context and inspection; it never causes food and kill to cancel in
energy/health calculations.

Interpretation of a source sample is exact:

| Sample | Meaning |
|---|---|
| `s = +1` at surface | Full food exposure; maximum authored energy gain rate. |
| `0 < s < +1` | Proportional food exposure after falloff. |
| `s = 0` | No metabolic effect. |
| `-1 < s < 0` | Proportional kill exposure after falloff. |
| `s = -1` at surface | Full kill exposure; maximum authored health damage rate. |

Field gradients are analytic where practical and otherwise central-difference
sampled at 1 cm. Overlapping source order must not create a visible or semantic
difference.

## Example manifest shape

The exact JSON Schema lands with the field-API implementation issue. This P01
shape is the governing semantic contract:

```json
{
  "schemaVersion": "environment.v1",
  "id": "spectral-home",
  "displayName": "Spectral Homestead",
  "units": "meters",
  "coordinateSystem": "right-handed-y-up",
  "bounds": { "min": [-6, 0, -4], "max": [6, 3, 4] },
  "assets": [{ "id": "home-shell", "uri": "home-shell.glb", "sha256": "TBD" }],
  "sources": [
    {
      "id": "threshold-feed",
      "geometryId": "entry-threshold",
      "channels": {
        "effect": { "strength": 0.8, "rangeMeters": 0.45 },
        "obstacle": false
      }
    },
    {
      "id": "fault-kill",
      "geometryId": "fault-wall",
      "channels": {
        "effect": { "strength": -1.0, "rangeMeters": 0.30 },
        "obstacle": true
      }
    },
    {
      "id": "alcove-shelter",
      "geometryId": "under-stair-volume",
      "channels": { "shelter": 0.75 }
    },
    {
      "id": "window-habitat",
      "geometryId": "window-volume",
      "channels": { "habitat": [0.9, 0.1, 0.2] }
    }
  ],
  "spawnRegions": [{ "id": "living-spawn", "geometryId": "spawn-volume-a", "capacity": 8 }],
  "cameraPresets": ["home-hero", "home-inspect", "home-motion-look"],
  "looks": ["porcelain-spectrum", "technical-wire", "ghost-volume"],
  "qualityTiers": ["mobile", "desktop", "export"]
}
```

`TBD` is allowed only in this illustrative shape. A loadable manifest must use a
real checksum and schema-valid asset path.

## Spawn contract

A spawn region is an oriented box, sphere, or authored volume with a stable ID,
capacity, allowed phenotypes, minimum obstacle clearance, and default orientation.
For Home:

- the initial core must be at least 0.20 m from obstacle penetration;
- it must begin outside any source where kill `K > 0.05`;
- it may begin with food exposure no greater than `F = 0.10`;
- placements use a deterministic low-discrepancy sequence derived from run seed;
- failed placements report a visible authoring error rather than silently moving
  to an unrelated region.

## Obstacle, shelter, habitat, and flow combination

- Obstacles combine by minimum signed distance; ties resolve by stable source ID.
- Shelter combines with saturating union and clamps to `[0,1]`.
- Habitat channels combine by normalized weighted average; zero total weight
  yields `[0,0,0]`.
- Flow vectors sum then clamp to magnitude `1 m/s` for the MVP.
- Exclusion volumes combine by Boolean union and are sampled only for spawning.

None of these channels implicitly emits spectral color. They become colored only
during an allowed lifecycle event or explicit field inspection.

## Camera presets and Motion Look

A camera preset stores target, position or orbit parameters, vertical FOV, near
and far planes, roll policy, interaction limits, and safe framing region.

`home-hero` must frame the organism, food source, and kill source together at
38–46° vertical FOV. `home-inspect` may move closer and expose selected state.
`home-motion-look` begins from the hero pose and adds device orientation:

- permission follows an explicit user tap and failure leaves touch intact;
- alpha/beta/gamma are converted to a screen-orientation-corrected quaternion;
- the first accepted sample defines neutral orientation;
- yaw and pitch are enabled; roll is disabled by default;
- pitch clamps to ±55° from neutral and yaw to ±85° for the Home preset;
- smoothing is critically damped with a default 120 ms response;
- sensitivity defaults to 0.65 and is user-adjustable;
- Recenter redefines neutral without resetting the simulation;
- pinch controls zoom and touch drag supplies fallback/offset;
- device motion changes presentation only and never enters simulation hashes.

Motion Look is rotational. The project does not integrate accelerometer data to
claim physical X/Y/Z translation. Positional tracking would require a separate
AR-capable mode and contract.

## Look declarations

Manifests may select exposure and tessellation presets, but the material and
lighting meaning of each look comes from
[ART-DIRECTION.md](ART-DIRECTION.md). Switching looks is reversible and cannot
reload or advance simulation state.

## Quality tiers

| Tier | Render target | Organisms × slots | Geometry policy | Simulation policy |
|---|---|---:|---|---|
| Mobile | 30 fps, long edge ≤1280 px | 4 × 128 | Reduced ribbon/membrane subdivisions and shadow resolution | Same 30 Hz channels and rules |
| Desktop | 60 fps at 1920×1080 | 8 × 256 | Full authored tessellation and shadows | Same 30 Hz channels and rules |
| Export | Up to 3840×2160 still; 1920×1080/30 video target | Recorded tier | May increase render-only samples | Replays recorded ticks; never re-simulates at variable dt |

Automatic quality changes may adjust resolution, shadow size, bloom samples,
transparency method, and render tessellation. They may not remove organisms,
change node capacity mid-run, alter fields, or switch model weights.

## Environment-specific gates

### Home — vertical-slice gate

Home must independently demonstrate neutral collision, feeding threshold, kill
fault, shelter, habitat, spawning, one complete lifecycle, all three looks, hero
and Motion Look cameras, deterministic replay, exports, and tier performance. Its
measures are listed in [HOME-APPROVAL-CHECKLIST.md](HOME-APPROVAL-CHECKLIST.md).

### Forest — adaptation gate

Forest passes only after Home and must reuse all channels unchanged. It adds no
mandatory channel. A golden run must show a root feeding event, trunk/fault kill
event, neutral terrain collision, and habitat-conditioned path.

### Pond — adaptation gate

Pond passes only after Home. It must reuse all channels and adds authored flow
usage. A golden run must show inlet feeding, drain kill, collision with the basin,
and flow transport that does not directly change energy or health.

## Environment validation

A loadable environment must fail validation when:

- a stable ID is duplicated;
- source strength or channel value is out of range;
- an effect source has non-positive range;
- an asset checksum is missing or mismatched;
- a spawn region overlaps `K > 0.05` or lacks obstacle clearance;
- a camera preset omits safe bounds or fallback input;
- a required look is absent;
- the manifest version is unsupported;
- declaration order changes golden samples beyond float32 tolerance.
