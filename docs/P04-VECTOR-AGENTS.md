# P04 3D vector-agent visual system

P04 turns the benchmark fixture into a designed organism family. The visible
agent is still the simulation graph: cells are weighted nodes, adjacency is
structure, selected edges become tapered ribbons or contour faces, and semantic
state changes the form without replacing it with a conventional creature mesh.

![Morphology reference](../assets/reference/organism-morphology-reference.png)

![Lifecycle reference](../assets/reference/organism-state-reference.png)

## Shared visual grammar

Every family uses the same constrained vocabulary:

- weighted icosahedral points for core, structural, junction, and terminal cells;
- straight or curved graph edges with intentional retraction gaps;
- tapered two-triangle ribbons on calligraphic, contour, and selected branch edges;
- sparse contour loops that read as vector faces rather than solid animal skin;
- instanced five-sided forward markers, separate from simulation state;
- white dormant material with event-gated 470–620 nm emission.

The scene owns one node instance batch, one base edge batch, one emission edge
batch, one ribbon batch, and one direction-marker batch. An update changes typed
array values only. Death, reconnection, and LOD collapse endpoints toward an edge
midpoint instead of creating or destroying Three.js objects.

## Morphology families

| Family | Topology | Silhouette | Direction cue |
|---|---|---|---|
| Branching | Trunk plus deterministic dendritic forks | Rooted reach with explicit junctions and terminals | Trunk growth axis |
| Ribbon | Continuous spine plus sparse contour braces | Folded calligraphic stroke | Leading terminal along the sweep |
| Radial | Eight spokes plus every-third-ring contour loops | Halo, flower, or shell | Normal of the radial plane |

Stable organism IDs combine the unsigned run seed with a seeded 32-bit identity.
Each node keeps a stable parent, role, organism index, and buffer slot. The
generated graph never exceeds degree eight.

## NCA-to-geometry decode

The hidden state remains renderer-independent. P04 gives its first six channels
a versioned decoded role; they do not map directly to arbitrary color.

| Source | Visible output |
|---|---|
| Channels 0–2 | Restrained XYZ micro-offset and local activity |
| Channel 3 | Structural thickness |
| Channel 4 | Curvature around the organism centerline |
| Channel 5 | Connection gate used by edge/ribbon retraction |
| Energy | Feeding state, thickness support, blue transfer permission |
| Health + previous health | Damage, dying, death, or regeneration state |
| Static node role | Core/junction/terminal scale and LOD importance |
| Semantic event | Allowed wavelength and emission intensity only |

`nca=frozen` holds the hidden channels fixed. Environment energy and health can
still be inspected, but learned deformation stops; tests assert that the latent
buffer remains byte-identical across frozen ticks.

## Lifecycle language

| State | Color permission | Form behavior |
|---|---|---|
| Dormant | None | Stable white graph |
| Feeding | Blue life band | Thickened nodes and directed transfer |
| Starving | None | Reduced thickness and ribbon weight |
| Damaged | Coral/orange-red below 620 nm | Curvature fault and partial edge gaps |
| Mutating | Restrained middle band | Local topology pulse |
| Dying | Approaches red | Strong edge retraction and collapse |
| Death | Exclusive 620 nm red | Near-total connection collapse and extinction |
| Regenerating | Returns toward 470 nm blue | Outward reconnection from survivors |

## LOD without semantic loss

The topology assigns importance `0` to braces/micro-contours, `1` to ordinary
structure, and `2` to cores, junctions, terminals, and silhouette edges.

| LOD | Distance intent | Preserved detail |
|---|---|---|
| Overview | Room-scale | Importance 2 |
| Mid | Organism group | Importance 1–2 |
| Macro | Inspection | All detail |

Mobile selects a lower LOD slightly sooner, but node capacity, lifecycle state,
field semantics, and color meaning remain unchanged.

## Deterministic capture harness

Open a stable browser capture with:

```text
?organisms=1&seed=1397769539&tick=180&state=feeding&look=porcelain&distance=mid&nca=frozen
```

Parameters:

| Query | Values |
|---|---|
| `seed` | decimal or `0x` unsigned 32-bit seed |
| `tick` | `0–900`; supplying it pauses the run at that tick |
| `state` | dormant, feeding, starving, damaged, mutating, dying, death, regenerating |
| `look` | porcelain, technical, ghost |
| `distance` | overview, mid, macro |
| `nca` | live, frozen |

State override is presentation-only and excluded from the simulation hash. Run
`npm run capture:organisms` to regenerate the two committed 1536×1024 CPU vector
references and their SHA-256 manifest.

## Performance evidence

The 2026-08-07 Node reference run includes the new graph adjacency, visual
decoder, dynamic gaps, and full ribbon buffers.

| Tier | Nodes | Edges | Paired tick + pack median | P95 | Budget |
|---|---:|---:|---:|---:|---:|
| Mobile | 512 | 556 | 0.753 ms | 1.024 ms | Simulation P95 ≤8 ms |
| Desktop | 2,048 | 2,248 | 2.778 ms | 3.100 ms | Simulation P95 ≤4 ms |

These are CPU reference measurements, not physical Safari evidence. P02 still
owns the deferred Mac and iPhone browser captures.

## Creative approval gate

Automated tests cover family identity, graph degree, pooled-buffer reuse,
lifecycle decode, exclusive death red, frozen NCA, stable capture parsing, and
LOD monotonicity. P04 remains open until the morphology and lifecycle references
are creatively approved and a physical browser view confirms junction and
terminal quality at Overview and Macro distances.
