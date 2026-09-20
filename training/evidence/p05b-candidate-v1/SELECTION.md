# P05b candidate evidence — first full campaign

Issue: #31  
Checkpoint family: `p05b-candidate-v1`  
Training seed: `240807`

## Command

```bash
PYTHONPATH=training python training/run_bounded.py \
  --config training/configs/p05b.yaml \
  --phenotype all \
  --out training/artifacts/p05b
```

The tracked config used 96 training steps, 16-step training unrolls, and a 512-step evaluation horizon for 32 nodes with 16 latent channels, 6 sensor channels, hidden width 64, and update rate 0.25.

## Execution environment

This captured run was executed from the exact tracked Python sources and config, but the available local packages were:

- Python runtime: local container
- Torch: 2.10.0+cpu
- NumPy: 2.3.5
- PyYAML: 6.0.3

The repository pins Torch 2.8.0, NumPy 2.3.2, and PyYAML 6.0.2. Therefore these artifacts are **exploratory evidence, not the deterministic-QA canonical run**. The deterministic reviewer must repeat the command in the pinned environment before any checkpoint is promoted.

## Outcome

**No viable browser checkpoint is selected from this campaign.**

All three candidates remain finite at the 512-step horizon (`nan_rate = 0`), but each fails a material part of the selection objective:

| Phenotype | Useful movement vs baseline | Blocking result |
| --- | --- | --- |
| Branching | Phenotype target loss improves by 141.191; positive response +68.550; negative response +76.113 | Stability error worsens by 406.254, max state rises by 12.713, and recovery delta worsens by 5.925 |
| Ribbon | Stability error improves by 626.315; recovery delta improves by 7.256; max state improves by 2.286 | Phenotype target loss worsens by 116.614 |
| Radial | Stability error improves by 641.295; recovery delta improves by 8.995; max state improves by 8.168 | Phenotype target loss worsens by 275.204 |

The three models share the same 16-channel / 64-hidden architecture, so binary size does not provide a meaningful smallest-candidate discriminator.

## Checkpoint digests from this run

- Branching: `a60bc28efe5751d6aa05cdafadd65fcd6a3adf4e5db259564b333f4946a64197`
- Ribbon: `06c7fa9286dd9943651c86a4c5ad2bff84ce8305519788df90d23a0608f069bf`
- Radial: `2141649f32eada840f4d1e602a1584e9005619e1feff32f476ae6f0ad6a53cd2`

The rejected `.pt` binaries are intentionally not promoted into the repository. Their digests are retained here and in the manifests.

## Next gate

1. Reproduce this campaign under the pinned requirements.
2. Retune the training objective/curriculum so phenotype identity improves without sacrificing boundedness/recovery.
3. Add preview/state-evolution evidence; the current runner emits metrics/model cards but no preview sequences.
4. Only after a candidate clears those gates should #42 consume it as the browser checkpoint.

This result keeps #31 open. It is evidence that the current objective needs another iteration, not a production-quality claim.
