# M1 CPU pilot: pool-trained Branching graph NCA — exit test PASS

Roadmap milestone M1 ("Can the NCA live?"). This is the **CPU pilot** run in a
4-CPU container. The full-size run (`configs/m1-pool-full.yaml`, Apple M5 Max,
`--device mps`) is still to be run; see "Run on Apple Silicon" in
`training/README.md`.

**Verdict: PASS** — the pilot checkpoint passes every pre-registered M1 exit
criterion on held-out fire seeds and held-out lesion centres at 512, 1,024, 2,048
and 4,096 ticks. The untrained baseline fails growth, field response and recovery.
The ROADMAP fallback (hand-authored local rules) is not needed for M2. Read the
limitations below before treating this as more than a go signal.

## What was trained

- Graph: `createBranchingMorphology(128)` from `src/organisms/morphology.ts`
  (128 slots = `QUALITY_TIERS.mobile.slotsPerOrganism`), ported exactly (a test
  compares the parent array with Node output). Tree edges only; depth 30, 13 tips.
- State: 16 channels — 0 alive, 1 thickness, 2 tip, 3–15 hidden.
- Perception per node: `[self, mean(neighbours) − self, parent − self,
  mean(children) − self, 6 sensors]` → 70 inputs. The parent/children
  differences are the graph analogue of Sobel-x/y (a topological frame along the
  parent edge); mean(neighbours) − self is the graph Laplacian. Sensors enter the
  perception directly, so F and K can drive opposite updates.
- Update: `s += mask · W2 · relu(W1 · p + b1)`; 70 → 64 (ReLU) → 16, no output
  bias, W2 zero-initialised (the untrained model is an exact no-op).
- Stochastic update: fire rate **0.5**, `counterRandom(seed, 0, node, tick, stream) < 0.5`.
  The existing P05 `update_rate` is a deterministic residual step size, not a
  per-node fire probability, so it is not the growing-NCA mechanism; fire rate 0.5
  with an unscaled residual is the Distill recipe, and using the repo's
  `counterRandom` lets the browser reproduce the exact mask.
- Alive masking: a node lives if the max alive channel over itself and its tree
  neighbours exceeds 0.1 both before and after the update; otherwise the whole node
  state is zeroed.
- Seed: root node 0 with alive and hidden channels at 1, everything else 0.
- Target (visible channels): alive 1 everywhere; thickness tapering 0.6 → 0.2 by
  depth and scaled locally by `1 + 0.5 · (F + K)` (F ≥ 0 food, K ≤ 0 kill, separate
  channels); tip 1 at leaves.
- Recipe: pool 256, batch 8; the highest-loss sample is replaced by the seed; the 2
  lowest-loss samples receive a contiguous 25% lesion (BFS region around a training
  centre, node % 4 ≠ 3) from iteration 200; rollout length uniform in [64, 96];
  field scenarios resampled per sample each iteration (40% neutral, 15% each of
  uniform food, uniform kill, local food, local kill; amplitude 0.3–1.0); loss =
  visible MSE + 1.0 × mean per-tick overflow `mean(|s − clamp(s, −1, 1)|)`;
  per-parameter gradient normalisation; Adam lr 2e-3, ×0.1 at iteration 3,000;
  4,000 iterations; final checkpoint (no checkpoint picking).

## Command and environment

```bash
PYTHONPATH=training python training/run_pool.py --config training/configs/m1-pool.yaml \
  --out training/artifacts/m1-pool --device cpu --threads 2
PYTHONPATH=training python training/evaluate_m1.py --config training/configs/m1-pool.yaml \
  --checkpoint training/artifacts/m1-pool/branching-m1.pt \
  --out training/evidence/m1-pool/evaluation.json --device cpu --diagnostics
```

- CPU (x86_64, 4 vCPU container), Python 3.11.15, torch 2.8.0 (`+cu128` PyPI wheel,
  executed on CPU), NumPy 2.3.2, deterministic algorithms on, 2 torch threads for
  training. Training wall time 830.8 s; evaluation 31 s.
- Checkpoint `branching-m1.pt` (not committed) SHA-256
  `ea24b446c2aeef786e4ef93b4e1f3e265457f2b85a9f5e53269b9c247e4ec03e`.
- Committed evidence: `evaluation.json`, `branching-m1.manifest.json`,
  `branching-m1.history.json` (every 50 iterations), `branching-m1.weights.json`
  (browser JSON weights + golden vector).

## Exit test (pre-registered in `vector_nca/m1_eval.py`)

Held out: fire seeds 900001–900004 on counterRandom stream 1 (training uses stream
0); lesion centres 19, 51, 83, 115 from the held-out set (node % 4 = 3), which
training never lesions. Lesion at tick H/2, repair for H/2 ticks, compared with
the intact rollout under the same fire seed.

| Criterion | Threshold |
| --- | --- |
| Grows | mean alive coverage (alive ≥ 0.5) ≥ 0.90 and growth progress `1 − mse/seed_mse` ≥ 0.80 |
| Opposite field response | uniform F = +0.8 thickness Δ ≥ +0.05; uniform K = −0.8 thickness Δ ≤ −0.05 |
| Recovery | mean `1 − E_final/E_immediate` (visible channels, lesioned nodes) ≥ 0.75 |
| Bounded | all finite; max\|s\| over (2048, 4096] ≤ 1.1 × max\|s\| over (512, 1024] |

| Model | Horizon | Alive cov. | Growth progress | Visible MSE | F Δthick | K Δthick | Recovery mean (min) | max\|s\| window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Untrained | 512 | 0.008 | 0.000 | 0.423 | +0.000 | +0.000 | 0.00 (0.00) | 1.000 |
| Untrained | 1,024 | 0.008 | 0.000 | 0.423 | +0.000 | +0.000 | 0.00 (0.00) | 1.000 |
| Untrained | 2,048 | 0.008 | 0.000 | 0.423 | +0.000 | +0.000 | 0.00 (0.00) | 1.000 |
| Untrained | 4,096 | 0.008 | 0.000 | 0.423 | +0.000 | +0.000 | 0.00 (0.00) | 1.000 |
| **Pilot** | 512 | 1.000 | 1.000 | 5.2e-6 | +0.164 | −0.164 | 0.9999 (0.9999) | 1.000 |
| **Pilot** | 1,024 | 1.000 | 1.000 | 5.2e-6 | +0.164 | −0.164 | 1.0000 (1.0000) | 1.000 |
| **Pilot** | 2,048 | 1.000 | 1.000 | 5.2e-6 | +0.164 | −0.164 | 1.0000 (1.0000) | 1.000 |
| **Pilot** | 4,096 | 1.000 | 1.000 | 5.2e-6 | +0.164 | −0.164 | 1.0000 (1.0000) | 1.000 |

Max\|state\| by window for the pilot: 0–512 1.018, 512–1,024 0.99985,
1,024–2,048 0.99985, 2,048–4,096 0.99985 (trend ratio 1.000). The target thickness
response for F/K = ±0.8 is ±0.164 averaged over nodes, so the response is the
trained one, not a side effect. The untrained baseline is bounded (it never moves)
and recovers nothing: its lesions hit empty nodes, which the protocol scores as 0.

## Non-gating diagnostics (added after the exit test ran; never used for the verdict)

From `trained_diagnostics_non_gating` in `evaluation.json`, lesions on a mature
organism (tick 512), all 32 held-out centres × 4 held-out seeds:

| Ticks after lesion | 16 | 32 | 64 | 128 | 256 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 25% lesion, mean (min) recovery | 0.41 (0.18) | 0.82 (0.52) | 0.996 (0.982) | 0.9995 | 0.99995 |
| 50% lesion, mean (min) recovery | 0.31 (0.21) | 0.70 (0.56) | 0.988 (0.971) | 0.9994 | 0.99995 |

- Fields switched on at maturity: thickness Δ after 128 ticks +0.164 (food),
  −0.164 (kill); visible MSE to the field target ~6e-6; 128 ticks after the field
  is removed the organism is back on the neutral target (MSE ~5e-6).
- A food patch on 25% of nodes thickens the patch by +0.188 and the rest by +0.001:
  the response is local.
- At tick 4,096 the mean |state change| per tick is 7e-9 (max 1.8e-7).

## Limitations — read before promoting

- **It converges to a fixed point.** The mature organism is essentially static
  (7e-9 change per tick). "Bounded" is satisfied trivially by an attractor; any
  "quietly alive" motion has to come from elsewhere (sensor changes, lifecycle,
  rendering), or from a target that asks for it.
- **The target is hand-defined and simple** (alive, depth-tapered thickness, tip
  flag). It proves the recipe makes a stable, regenerating, field-responsive
  attractor on the real graph; it does not prove a creatively approved phenotype.
  Visual review in the browser (M2) still governs.
- **Held-out means** unseen fire-mask seeds/stream and unseen lesion centres. There
  is one seed state (root node 0), one topology (128-slot Branching), one training
  seed. Other slot counts (256, desktop) and other seed nodes are untested.
- The field response is largely a direct local mapping (sensors are in the
  perception), with F and K on separate channels as D004 requires. Only uniform
  and one local patch were evaluated; spatial gradients were not.
- CPU pilot only. The full M5 Max run can change numbers; MPS runs are not bitwise
  comparable with CPU (the manifest records device and torch version).

## For M2 (browser)

`branching-m1.weights.json` (`format: vector-sim.graph-nca.v1`,
`architecture: vector_graph_nca_v1`) carries the parent array, channel and sensor
layout, perception order, fire-mask rule, row-major `w1 [64, 70]`, `b1 [64]`,
`w2 [16, 64]`, and golden frames (full 128 × 16 state at ticks 1, 8, 32 from the
seed, neutral sensors, fire seed 12345, stream 2). An independent float32 NumPy
re-implementation written only from that JSON reproduces the golden frames within
2.4e-7.
