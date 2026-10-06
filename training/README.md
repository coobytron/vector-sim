# Vector NCA training

This folder contains the deterministic P05 training pipeline for issue #6. P05a established the reproducible smoke-training and checkpoint contract; P05b adds bounded candidate training, longer-horizon evaluation, and explicit comparison against an untrained baseline.

## Setup

```bash
python3 -m venv .venv-training
source .venv-training/bin/activate
python -m pip install -r training/requirements.txt
```

## Deterministic tests

Run from the training folder so the local `vector_nca` package is importable without installation:

```bash
cd training
pytest -q
```

The tests cover fixture repeatability, same-seed rollout repeatability, phenotype/evaluation contracts, lesion and positive/negative field fixtures, checkpoint round-trip, model-card creation, and deterministic bounded-training output.

## P05a smoke training

```bash
PYTHONPATH=training python training/smoke_train.py \
  --config training/configs/reference.yaml \
  --phenotype branching \
  --out training/output/branching-smoke.pt
```

## P05b bounded candidate training

Train all three phenotype families:

```bash
PYTHONPATH=training python training/run_bounded.py \
  --config training/configs/p05b.yaml \
  --phenotype all \
  --out training/artifacts/p05b
```

Each phenotype emits a checkpoint, manifest, model card, evaluation report, deterministic preview JSON, and a source-stable SVG state-evolution strip. The default P05b config evaluates for substantially longer than the training unroll to expose divergence rather than hiding it inside a short optimization horizon.

P05b training and evaluation use controlled scenarios rather than the training fixture verbatim: neutral, positive-only, and negative-only field inputs are rolled out separately. Training uses a response margin plus cross-channel penalty so it cannot satisfy the field objective merely by drifting all channels together. The recovery objective applies the configured lesion after a pre-roll and trains the damaged branch toward an intact counterfactual at the same final tick.

P05b evaluation uses the same separated field scenarios. Recovery is measured by actually zeroing the configured lesion region after a pre-roll, then comparing the recovered state against an intact counterfactual at the same final tick. `damage_recovery_delta` is positive only when the final lesion error is smaller than the immediate damage; `damage_recovery_error` reports the remaining absolute error.

The v4 recovery objective differentiates through both final rollouts. It freezes
only their common pre-lesion seed and immediate-damage budget. In v3, the intact
rollout was detached: a shared additive drift could receive a recovery gradient
even though it leaves the actual damaged-versus-intact gap unchanged. The paired
gradient removes that false incentive while retaining the same forward loss,
75% recovery target, architecture, and v2 evaluation protocol. The P05b config
also aligns recovery training with the 512-tick fixture: 128 pre-lesion ticks
and 384 recovery ticks, instead of 16 and 64. Morphology and field training
retain their 32-tick unroll. A gradient-only ablation isolates the objective
correction from this horizon change.
An analytic affine-model regression test checks drift cancellation and verifies
the contraction gradient against finite differences. This correction is not a
checkpoint promotion; measured campaign results and visual review still govern
selection.

Run the additional stress evaluation against those saved checkpoints:

```bash
PYTHONPATH=training python training/evaluate_stress.py \
  --config training/configs/p05b.yaml \
  --checkpoints training/artifacts/p05b \
  --out training/artifacts/p05b/stress-evaluation.json
```

It retains the same evaluation protocol, testing half-size and 1.5-times-size
centered lesions at the evaluation horizon, then the original lesion at twice
and four times that horizon. The CI evidence campaign also records these tests;
a successful job means the measurements completed, not that a candidate passed.

The checkpoint manifest now records `update_rate` explicitly so P06 inference can reconstruct execution semantics from exported metadata instead of relying on a runtime default.

## M1 pool training (growing-NCA recipe on the Branching graph)

Roadmap milestone M1 ("Can the NCA live?") uses a separate model, runner and
evaluation so P05b stays reproducible:

- `vector_nca/graph_nca.py` — `vector_graph_nca_v1`: the 128-slot Branching tree
  ported from `src/organisms/morphology.ts`, graph perception
  (self, mean(neighbours) − self, parent − self, mean(children) − self, six sensors),
  alive masking, a stochastic fire mask ported from `src/simulation/prng.ts`, and a
  zero-initialised two-layer update MLP.
- `vector_nca/pool.py` — sample pool, highest-loss seed replacement, lowest-loss damage.
- `vector_nca/m1.py` — training loop (random 64–96 tick rollouts, overflow loss,
  per-parameter gradient normalisation, Adam with step decay), checkpoint manifest and
  JSON weight export for the browser.
- `vector_nca/m1_eval.py` / `evaluate_m1.py` — the M1 exit test on held-out fire seeds
  and held-out lesion centres at 512/1,024/2,048/4,096 ticks, baseline vs checkpoint.

CPU pilot (the deterministic reference; `--threads` pins torch CPU threads):

```bash
PYTHONPATH=training python training/run_pool.py --config training/configs/m1-pool.yaml \
  --out training/artifacts/m1-pool --device cpu --threads 2
PYTHONPATH=training python training/evaluate_m1.py --config training/configs/m1-pool.yaml \
  --checkpoint training/artifacts/m1-pool/branching-m1.pt \
  --out training/evidence/m1-pool/evaluation.json --device cpu
```

`--device auto` picks MPS, then CUDA, then CPU. Only CPU runs enable
`torch.use_deterministic_algorithms`; MPS/CUDA results can differ bitwise from CPU
and between runs. The manifest records the training device, torch version and
thread count next to the checkpoint SHA-256, and the evaluation report records the
evaluation device, so evidence from different devices is never conflated.

### Run on Apple Silicon (full M1 run)

`configs/m1-pool-full.yaml` uses the same graph, channels, fire rate and evaluation
protocol as the pilot with a 1,024-state pool, batch 16, hidden width 128 and 8,000
iterations (sized for roughly 1–3 hours on an M5 Max). From the repository root:

```bash
python3 -m venv training/.venv-training
source training/.venv-training/bin/activate
python -m pip install -r training/requirements.txt

# Train (logs one JSON line every 50 iterations).
PYTHONPATH=training python training/run_pool.py \
  --config training/configs/m1-pool-full.yaml \
  --out training/artifacts/m1-pool-full --device mps 2>&1 | tee training/artifacts/m1-pool-full.log

# Held-out 4,096-tick exit test, untrained baseline vs the checkpoint.
# Evaluate on CPU so the numbers are comparable with the pilot; add --device mps to compare.
PYTHONPATH=training python training/evaluate_m1.py \
  --config training/configs/m1-pool-full.yaml \
  --checkpoint training/artifacts/m1-pool-full/branching-m1.pt \
  --out training/evidence/m1-pool-full/evaluation.json --device cpu

# Evidence to commit (small JSON only; never the .pt):
cp training/artifacts/m1-pool-full/branching-m1.manifest.json \
   training/artifacts/m1-pool-full/branching-m1.history.json \
   training/artifacts/m1-pool-full/branching-m1.weights.json \
   training/evidence/m1-pool-full/
```

Then add a `SELECTION.md` beside them (same structure as
`evidence/m1-pool/SELECTION.md`) with the verdict from `evaluation.json`.
`training/artifacts/` and `*.pt` are git-ignored.

## State contract

The reference model accepts per-node latent state plus sensor channels. Six sensor channels are currently reserved for positive field, negative field, directional gradient, habitat-like center weighting, alive/energy gate, and a future/custom channel. P06 should rely on manifest dimensions and explicit metadata rather than phenotype-specific branches.

The model uses local state plus a deterministic rolled neighbor as a compact reference perception operator. This remains intentionally small while phenotype objectives, graph perception, and runtime export are validated.

## Metrics

The training path reports:

- growth
- stability error
- positive-only field response relative to neutral
- negative-only field response relative to neutral
- positive-vs-negative field contrast
- lesion recovery delta, fraction, and final error against an intact counterfactual
- bounded maximum state
- NaN rate
- phenotype target loss
- delta versus the same seeded untrained model

These metrics are evidence for candidate selection, not proof of visual quality. Final acceptance still requires preview sequences, morphology review, regeneration evidence, and physical-device/browser validation.

## Determinism limits

`torch.use_deterministic_algorithms(True)` plus pinned dependencies and explicit Python/NumPy/Torch seeds are used. Exact byte-identical trained weights are expected only inside the pinned CPU environment. Cross-device/GPU execution may require tolerance-based comparisons and must be measured before #6 is closed.

## Current non-goals

- claiming production-ready phenotype quality
- browser GPU inference
- environment-specific behavior
- replacing the shared field-provider contract
