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

Each phenotype emits a checkpoint, manifest, model card, and evaluation report containing trained metrics, untrained-baseline metrics, and deltas. The default P05b config evaluates for substantially longer than the training unroll to expose divergence rather than hiding it inside a short optimization horizon.

The checkpoint manifest now records `update_rate` explicitly so P06 inference can reconstruct execution semantics from exported metadata instead of relying on a runtime default.

## State contract

The reference model accepts per-node latent state plus sensor channels. Six sensor channels are currently reserved for positive field, negative field, directional gradient, habitat-like center weighting, alive/energy gate, and a future/custom channel. P06 should rely on manifest dimensions and explicit metadata rather than phenotype-specific branches.

The model uses local state plus a deterministic rolled neighbor as a compact reference perception operator. This remains intentionally small while phenotype objectives, graph perception, and runtime export are validated.

## Metrics

The training path reports:

- growth
- stability error
- positive field response
- negative field response
- damage/recovery delta
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
