# Simulation contract

This document defines the environment-independent organism model. It is
normative for training, runtime inference, replay, and export.

## Terminology

**NCA means Neural Cellular Automata.** Each organism is a collection of cells
that repeatedly applies the same learned local update rule. “Neural Correlation
Network” is not the architecture used by this project.

A **cell** is both an NCA state carrier and a graph node. An **organism** owns a
bounded sparse graph of cells. The **environment** is not an NCA grid; it is
sampled through typed fields. A **tick** is one fixed simulation update.

## Coordinate, time, and numeric conventions

- World distance: meters (`m`).
- Linear velocity: meters per second (`m/s`).
- Acceleration: meters per second squared (`m/s²`).
- Time: seconds (`s`).
- Orientation: right-handed coordinates, +Y up, +Z forward in environment-local
  space; render backends may transform at their boundary.
- Runtime state: IEEE-754 `float32` unless an implementation proves a compatible
  packed representation.
- Simulation cadence: fixed 30 Hz (`dt = 1/30 s`). Rendering interpolates and
  must not change simulation `dt`.
- Catch-up: at most four ticks per rendered frame. Beyond that, simulation time
  slows; no variable-step update is permitted.
- Seeds and stable entity IDs are unsigned 64-bit values serialized as strings.

## Topology decision

The MVP uses a **per-organism, fixed-capacity, dynamic sparse graph**, not a
shared world grid.

| Property | Desktop/full tier | Mobile/reduced tier |
|---|---:|---:|
| Node slots per organism | 256 | 128 |
| Maximum graph degree | 8 | 8 |
| Maximum births per tick | 4 | 2 |
| Maximum organisms in authored Home preset | 8 | 4 |
| Perception source | Graph neighbors + sampled fields | Same contract |

Inactive slots retain stable IDs so topology can regrow without reallocating the
runtime buffer. Quality tiers may reduce capacity and visual tessellation; they
may not change field semantics or the learned channel layout.

## Organism and cell state

An organism stores a stable `organismId`, `seed`, phenotype/weights identifier,
8-value genotype vector, birth tick, graph adjacency, and its cell slots.

Each cell stores:

| Name | Type | Unit/range | Meaning |
|---|---|---|---|
| `position` | `float32[3]` | world `m` | Cell center. |
| `velocity` | `float32[3]` | clamped to ±1.5 `m/s` | Integrated movement state. |
| `latent` | `float32[24]` | bounded to `[-1, 1]` | Hidden learned state; never rendered directly. |
| `energy` | `float32` | `[0, 1]` | Local metabolic resource. |
| `health` | `float32` | `[0, 1]` | Local structural integrity. |
| `active` | `uint8` | `0` or `1` | Participation in perception/update. |
| `core` | `uint8` | `0` or `1` | Seed lineage required for organism survival. |
| `age` | `float32` | seconds, `≥0` | Active lifetime of this slot. |
| `parentId` | `uint16` | slot ID | Stable growth provenance. |

Decoded geometry and color are outputs, not hidden state. Renderer-specific
vertex buffers may cache them, but replay truth is the state above plus model,
environment, seed, and tick.

## Local perception input

The same perception vector is assembled for every active cell. Missing inputs
are zero-filled; channel order is versioned with the model.

| Input | Channels | Unit/range | Construction |
|---|---:|---|---|
| Self latent | 24 | `[-1,1]` | Current cell state. |
| Neighbor latent mean | 24 | `[-1,1]` | Mean across active graph neighbors. |
| Neighbor latent difference | 24 | `[-2,2]`, normalized before model | Neighbor mean minus self. |
| Neighbor geometry | 8 | normalized | Mean direction XYZ, direction variance XYZ, degree/8, mean edge length/0.25 m. |
| Local lifecycle | 4 | `[0,1]` | Energy, health, active, normalized age. |
| Food / kill / net effect | 3 | `F[0,1]`, `K[0,1]`, `E[-1,1]` | Sampled independently; `E = F - K`. |
| Effect gradient | 4 | unit XYZ + magnitude `[0,1]` | Gradient of signed effect. |
| Obstacle | 4 | SDF `[-1,1]` + unit normal XYZ | SDF is meters clamped to ±1 m. |
| Shelter | 1 | `[0,1]` | Metabolic protection only. |
| Habitat | 3 | each `[0,1]` | Authored phenotype-conditioning vector. |
| Flow | 3 | `m/s`, clamped to ±1 | Environmental transport vector. |
| Genotype | 8 | `[-1,1]` | Organism-level conditioning copied to each cell. |
| Tick phase | 2 | sine/cosine `[-1,1]` | Optional periodic context, period stored in model metadata. |

Food, kill, obstacle, shelter, habitat, and flow are different channels. No role
is inferred from environment names, mesh materials, object colors, or labels.

## Learned update and deterministic resolver

Each tick executes these stages in order:

1. Sample environment fields at every active cell position.
2. Aggregate graph-neighbor perception using stable ascending slot order.
3. Evaluate the shared NCA model for eligible cells.
4. Resolve topology proposals deterministically.
5. Apply metabolism, damage, and regeneration constraints.
6. Integrate velocity and position, then resolve obstacles.
7. Decode render state and calculate the tick hash.

The asynchronous NCA fire gate is deterministic. Eligibility uses a counter-based
PRNG keyed by `(runSeed, organismId, cellId, tick)` with default probability
`0.5`. No wall-clock time, renderer frame number, thread ordering, or unseeded
random source may enter the simulation.

The model emits proposals; hard constraints remain outside the learned model:

| Output | Activation / range | Runtime interpretation |
|---|---|---|
| `latentDelta[24]` | `tanh × 0.10` per tick | Added then clamped to `[-1,1]`. |
| `acceleration[3]` | `tanh × 2.0 m/s²` | Integrated with flow and collision response. |
| `energyTransfer` | `tanh [-1,1]` | Redistributes energy only across existing edges; total-conserving. |
| `repairGate` | sigmoid `[0,1]` | Modulates allowed health repair. |
| `birthScore` | sigmoid `[0,1]` | Proposal eligible above `0.70`. |
| `birthDirection[3]` | normalized vector | New cell direction in parent-local frame. |
| `birthLength` | `0.03–0.18 m` | Proposed parent-to-child distance. |
| `retractScore` | sigmoid `[0,1]` | Proposal eligible above `0.80`. |
| `materialMix[5]` | softmax | Node, edge, ribbon, branch, membrane visibility weights. |
| `thickness` | `0.003–0.035 m` | Edge/node structural scale. |
| `ribbonWidth` | `0.005–0.090 m` | Visible ribbon width. |
| `ribbonTwist` | `[-π,π] rad/m` | Orientation change along an edge. |
| `emissionWavelength` | `470–620 nm` | Used only when an allowed event gate is active; 470 nm means life and 620 nm means death. |
| `emissionIntensity` | `[0,1]` | Multiplied by the event envelope and look exposure. |

Birth proposals sort by score descending, then parent slot ascending, then target
slot ascending. The resolver accepts up to the tier birth cap, connects the child
to its parent and at most two healthy cells within 0.18 m, and never exceeds
degree 8. Retractions sort with the same stable rules. A proposal cannot directly
change field values or create energy.

## Energy and health

Food and kill are applied independently and do not cancel. For a cell with food
`F`, kill `K`, shelter `S`, repair gate `R`, timestep `dt`, motion cost `M`, and
accepted birth cost `B`:

```text
idleDrain = 0.012 × (1 - 0.40 × S) per second
energy'   = clamp(energy + 0.20×F×dt - idleDrain×dt - M - B, 0, 1)
repairOK  = energy' > 0.35 and K < 0.05
health'   = clamp(health - 0.35×K×dt + 0.08×R×repairOK×dt, 0, 1)
```

`M` is capped at `0.004` energy per tick and is derived from acceleration and
distance moved. Each accepted birth costs the parent `0.04` energy. A cell with
zero energy may sense and retract but cannot propose a birth or repair. Kill
damage continues even while feeding.

## Lifecycle semantics

### Spawn

A seed creates three connected core cells at a manifest-defined spawn transform.
Initial energy and health are `0.65` and `1.0`. Genotype and asynchronous update
gates derive from the run seed.

### Feed

Food increases local energy by the formula above. Energy may move only over
existing graph edges through a total-conserving transfer pass. The renderer may
show a spectral transfer only where `F > 0.05` or where transferred energy per
tick exceeds `0.005`.

### Damage and death

Kill lowers health locally. At `health < 0.20`, edges may visibly strain and the
cell becomes retract-eligible. At `health = 0`, the cell deactivates and its edges
disconnect. The organism is dead when all core cells are inactive or the mean
core health remains zero for 30 ticks. Death never emits a scene-wide flash.

### Regeneration

Regeneration is NCA growth from surviving healthy neighborhoods, not a scripted
mesh replacement. A birth counts as regeneration when it occupies a slot whose
lineage previously deactivated and the parent neighborhood has mean health
`≥0.60`. It uses the same energy costs and topology resolver as ordinary growth.

### Mutation

The MVP mutates the 8-value genotype, never model weights. A mutation is triggered
only by an explicit user action or a versioned authored event. Noise comes from
the run seed, is clamped to `±0.05` per selected genotype value, and is recorded in
replay. Mutation color lasts no more than 0.6 s and is limited to affected lineage.

## Visible decode contract

Hidden channels are never mapped directly to arbitrary colors. Geometry derives
from the decoded material mix, thickness, ribbon values, graph adjacency, health,
and age. Event type supplies the emission permission; wavelength/intensity merely
shape an allowed emission.

All looks consume the same decoded snapshot. A look may hide or expose topology
but cannot modify state, fields, collision, or lifecycle. Render interpolation
must be discarded when calculating replay hashes.

## Collision and flow

Obstacle fields supply a signed distance and outward normal. A cell inside an
obstacle is projected to the nearest non-penetrating point plus 1 mm and has its
inward normal velocity removed with restitution `0.05`. Flow adds environmental
velocity before integration and does not directly alter energy or health.

## Determinism, replay, and state export

A run is identified by:

- contract/schema versions;
- model identifier and weight checksum;
- environment manifest and asset checksums;
- run seed;
- ordered input-event timeline;
- quality tier and node capacity;
- fixed starting tick.

The canonical tick hash covers active masks, adjacency, positions, velocities,
latent state, energy, health, genotype, and mutation events after float32
quantization. Camera and look are recorded for presentation replay but excluded
from the simulation hash.

A deterministic implementation must match hashes at ticks 0, 300, and 900 for
the Home golden scenario on the same backend. Cross-backend tolerance tests may
compare quantized semantic state if strict float parity is not feasible; the
accepted tolerance and reason must be recorded in P02.

## Required simulation tests

1. Neutral fields change neither energy nor health beyond idle/motion costs.
2. Equal food and kill exposure increase energy and reduce health simultaneously.
3. Source declaration order does not change sampled field values or tick hashes.
4. The same seed and input timeline reproduce tick 0/300/900 hashes.
5. Renderer look and camera changes do not change simulation hashes.
6. Flow transports without changing health or energy directly.
7. Obstacle penetration resolves without adding kinetic energy.
8. A killed non-core branch can regenerate from a healthy surviving neighborhood.
9. A mutation is seeded, bounded, replayable, and does not change model weights.
10. Reduced quality keeps channel order and field/lifecycle semantics unchanged.
