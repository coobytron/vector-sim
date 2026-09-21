# P05b paired-gradient v4: recovery improves, promotion remains blocked

Related issues: #31 and #42. No checkpoint is selected for Home.

## Diagnosis and isolated comparison

V3 detached the intact final rollout while differentiating the damaged rollout.
For the simple update `state += drift`, the actual lesion gap is independent of
drift. V3 nevertheless gives drift a nonzero recovery gradient. The new analytic
regression test reproduces that bug, verifies zero drift gradient with paired
rollouts, and checks the contraction gradient against finite differences.

V4 freezes the common pre-lesion state and immediate-damage budget, then allows
gradients through both final rollouts. A separate config change aligns recovery
training with the existing evaluation: 128 pre-lesion ticks plus 384 repair ticks
instead of 16 plus 64. Architecture, seed, optimizer, training iterations, field
loss, loss weights, and the v2 evaluation protocol remain unchanged.

[local-comparison.json](local-comparison.json) records three controlled variants:
v3, the v4 gradient correction alone, and v4 with aligned recovery horizons.
All ran on CPU with the pinned Torch 2.8.0 / NumPy 2.3.2 / PyYAML 6.0.2 packages,
Python 3.12.14, and one CPU thread. Canonical CI uses Python 3.13; these are local
comparative results. The v3 control exactly reproduced the previously captured
v3 CI metrics for all three phenotypes.

| Phenotype | v3 recovery delta | Gradient-only delta | Aligned delta | Aligned recovery fraction | Aligned stability error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Branching | -0.052852 | -0.203030 | 0.300848 | 81.37% | 1.311794 |
| Ribbon | -0.080119 | -0.198955 | 0.293277 | 81.27% | 1.207514 |
| Radial | -0.116354 | -0.190992 | 0.271898 | 79.04% | 1.433700 |

The gradient correction alone reduces the runaway stability error from roughly
149–157 to 2.3–2.5 but does not establish recovery. With the aligned horizon, all
three recover on the 512-tick fixture. They also improve phenotype loss and
stability against the reported untrained baseline and remain finite. This
fixture now matches recovery training; it is not held-out generalization proof.

## Stress evaluation and decision

[local-stress.json](local-stress.json) retains changed-lesion and longer-horizon
measurements from `training/evaluate_stress.py`:

- At 512 ticks, all three recover for centered lesions affecting 12.5% and
  37.5% of nodes, as well as the trained 25% lesion.
- At 1,024 ticks, Branching and Ribbon retain small positive recovery; Radial
  becomes negative. Maximum absolute states reach approximately 12–13.
- At 2,048 ticks, all three fail recovery; maximum absolute states reach 30–33.

The retained preview JSON and SVG strips were inspected as **state diagnostics**:
they show the six sampled ticks and magnitude profiles. They are not organism
renders, spatial regrowth proof, or creative phenotype approval.

**Do not promote these checkpoints.** The paired-gradient correction fixes a
demonstrated optimizer defect and produces useful short-horizon recovery, but
long-run stability remains insufficient. The next training step needs exposure
to mature states and bounded long-run dynamics; simply accepting the 512-tick
result would hide a measured failure. Browser parity, physical-device testing,
graph-topology regeneration, and visual phenotype acceptance remain separate.

## Reproduction

Run the training and stress commands in `training/README.md`. To repeat the
gradient-only ablation, use this PR's code with `recovery_pre_steps: 16` and
`recovery_steps: 64`. For v3, use the parent commit's runner and config. The
workflow records the full campaign, config, environment receipt, previews,
checkpoint binaries, and stress report as an artifact; job success indicates
execution only.
