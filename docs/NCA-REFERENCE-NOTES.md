# NCA reference notes

Input for roadmap milestone M1 (`ROADMAP.md`). Two sources:

1. **Cells2Pixels** — Pajouheshgar, Xu, Abbasi, Mordvintsev, Jakob, Süsstrunk,
   *Neural Cellular Automata: From Cells to Pixels*, SIGGRAPH 2026
   (arXiv 2506.22899, project page cells2pixels.github.io). The project site was
   blocked by this environment's network policy; the notes below come from the
   page source and the growing demo's shader code
   (`cells2pixels.github.io/2d_growing_demo/`, fetched via raw GitHub). The paper
   PDF itself was not reachable, so loss details are not included here.
2. **Growing NCA** — Mordvintsev et al., *Growing Neural Cellular Automata*,
   Distill 2020. Summarized from background knowledge, not fetched.

## Cells2Pixels: what the paper claims

- A coarse NCA evolves on a lattice. A lightweight implicit decoder, the
  **LPPN** (Local Pattern Producing Network), maps interpolated cell state plus
  a local coordinate to appearance at any resolution.
- NCA and LPPN are trained jointly, end to end.
- It works on 2D grids, 3D grids, and **mesh vertices** (cells are mesh
  vertices; a sample point inside a triangle interpolates its three vertex
  states). The mesh case is the closest published analogue to our per-organism
  graph (D002).
- Both NCA and decoder are local, so inference parallelizes and runs in real
  time in the browser.
- Task-specific losses for morphogenesis (growth from a seed) and texture
  synthesis supervise high-resolution output cheaply. (Details are in the
  paper and were not retrieved.)

## Cells2Pixels growing demo: exact runtime

From the WebGL shader in the demo (`step()` and `updateSiren()`):

| Item | Value |
|---|---|
| State channels | 32 (8 × vec4), stored as `rgba16f` |
| Alive channel | channel 3 (alpha of the first vec4) |
| Perception | per channel: identity, Sobel-x, Sobel-y, Laplacian → 128 inputs |
| Laplacian kernel | `[[1,2,1],[2,-12,2],[1,2,1]]` |
| Update MLP | 128 → 256 (bias, ReLU) → 32 (no bias) |
| Update form | residual: `state += W2 · relu(W1 · perception + b1) · dt` |
| `dt` | `min(1, 1/dx²)`; kernels scaled by `dx` so the grid can be rescaled without Euler overshoot |
| Stochastic update | each cell fires with probability 0.5 per step |
| Alive mask | if max alpha in the 3×3 neighborhood < 0.1, zero the whole cell state |
| Seed | one cell: alpha = 1 and hidden channels = 1; everything else 0 |
| Damage | brush zeros all channels within a radius |
| Boundary | wrap-around |
| Decoder (LPPN) | SIREN, 4 layers, `sin(10·a)` activations; input = interpolated state (bilinear) + `sin/cos(π · local patch coordinate)` |
| Decoder mask | same 3×3 max-alpha < 0.1 → output transparent |

## Growing NCA training recipe (Distill 2020, background)

- **Sample pool**: pool of 1,024 states, batch of 8. Each batch, replace the
  highest-loss sample with a fresh seed; write evolved states back to the pool.
  This trains the model on mature states and turns the target into an
  attractor, which is what gives long-horizon stability.
- **Damage during training**: damage the lowest-loss samples in each batch
  (random circular cut-out) so regeneration is trained, not hoped for.
- **Rollout length**: random 64–96 steps per iteration.
- **Stochastic updates**: fire rate 0.5.
- **Alive masking** as above.
- **Final layer zero-initialized** so the initial model is a no-op.
- **Optimizer**: Adam, lr 2e-3 decayed ×0.1 after 2,000 steps; per-parameter
  gradient normalization before the step.
- **Overflow loss**: penalize state values outside [-1, 1] (used in later
  NCA work) to keep dynamics bounded.

## Mapping onto the vector-sim graph NCA

| Grid NCA | Graph NCA here |
|---|---|
| Sobel-x / Sobel-y | per-edge differences projected onto the node's local frame (e.g. parent-edge direction and its normal) |
| Laplacian | graph Laplacian: `mean(neighbors) − self` |
| Identity | own state |
| Environment input | the six field sensor channels (F, K, habitat, shelter, …) appended to perception |
| Alive channel + 3×3 max-pool | an alive channel with 1-hop neighborhood max; nodes below 0.1 free their slot |
| LPPN decoder | a small shared MLP that decodes interpolated node state along an edge (plus the edge-local coordinate) into thickness, curvature, ribbon width, facet opacity — the "decoded separately" geometry of D003 |
| Pool + damage | pool of graph states; damage = zero a lesion region of nodes |

The v4 training evidence (`training/evidence/p05b-paired-gradient-v4/`)
concludes that the next step "needs exposure to mature states and bounded
long-run dynamics". Pool training plus the overflow loss address both directly.
