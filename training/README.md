# Vector NCA training scaffold

This folder implements the P05a deterministic training/evaluation contract for issue #25 and parent #6. It is deliberately a **smoke-training scaffold**, not a claim that Branching, Ribbon, or Radial have reached production phenotype quality.

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

The tests cover exact fixture repeatability, same-seed rollout repeatability, the shared phenotype/evaluation contract, lesion and positive/negative field fixtures, checkpoint round-trip, manifest metadata, and model-card creation.

## CPU smoke training

```bash
python training/smoke_train.py \
  --config training/configs/reference.yaml \
  --phenotype branching \
  --out training/output/branching-smoke.pt
```

Repeat for `ribbon` and `radial`. The three phenotype names select different target descriptors while preserving one model/state/checkpoint contract.

A run creates:

- `.pt` PyTorch state dictionary
- `.manifest.json` with architecture, phenotype, dimensions, dtype, version, SHA-256, training seed, metrics, limitations, and intended use
- `.model-card.md` with the same core provenance in readable form

## State contract

The reference model accepts per-node latent state plus sensor channels. The current fixture reserves six sensor channels for positive field, negative field, directional gradient, habitat-like center weighting, alive/energy gate, and a future/custom channel. P05b may refine semantics, but P06 should rely on manifest dimensions and explicit channel metadata rather than hard-coded phenotype branches.

The model uses local state plus a deterministic rolled neighbor as a compact reference perception operator. This is intentionally simple enough to validate the export contract before investing in the final learned graph neighborhood/perception architecture.

## Metrics

The scaffold emits the metric families required by #6:

- growth
- stability error
- positive field response
- negative field response
- damage/recovery delta
- bounded maximum state
- NaN rate
- phenotype target loss

P05b must replace the smoke proxy losses/targets with validated morphology, locomotion, field-response, and regeneration objectives and evaluate beyond the training unroll.

## Determinism limits

`torch.use_deterministic_algorithms(True)` plus pinned dependencies and explicit Python/NumPy/Torch seeds are used. Exact byte-identical trained weights are only expected inside the pinned CPU environment. Cross-device/GPU execution may require tolerance-based comparisons; those tolerances must be measured before #6 is closed.

## Non-goals of P05a

- production-trained phenotype checkpoints
- browser inference
- GPU/WebGL export
- final graph neighborhood operator
- evidence of learned regeneration quality
- environment-specific behavior
- changes to Claude-owned field work in #22
