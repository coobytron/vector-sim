# P05b recovery-margin v3: no checkpoint selected

The pinned [evidence campaign](https://github.com/coobytron/vector-sim/actions/runs/35535186261)
completed successfully on September 20, 2026. That indicates successful execution,
not a passing model. The run used PR #66 head `b6cd7aded48e844a1f9cb16e09c6d6cd9050eb9f`
through its synthetic merge commit `adcfc2262dd9d8a691a99dd7de7b4c237ffee726`.

[campaign.json](campaign.json) preserves the evaluation reports printed by job
`106142832928`, including baseline comparisons, checkpoint digests, training
objective, evaluation protocol, and horizons. This is extracted log evidence;
checkpoint binaries and preview artifacts were not inspected in this review.
The original artifact is `10613030037` (30-day workflow retention).

| Phenotype | Recovery delta | Phenotype loss | Stability error | Max absolute state | NaN rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Branching | -0.052852 | 27.999952 | 148.528397 | 13.701316 | 0 |
| Ribbon | -0.080119 | 23.415442 | 157.363922 | 12.834558 | 0 |
| Radial | -0.116354 | 23.718241 | 153.247955 | 12.764129 | 0 |

All recovery deltas remain negative: post-lesion error increases rather than
recovers. Improvement relative to the untrained model does not establish
positive recovery. Phenotype loss and stability error also worsen versus the
reported untrained baseline for every candidate.

**Reject all three candidates for browser promotion.** Issues #31 and #42 remain
open; Home continues to use the reference NCA. The next training iteration must
demonstrate positive measured lesion recovery together with bounded evolution,
phenotype quality, and inspected previews. Physical WebGL2 parity, device
performance, and creative Home approval remain separate acceptance gates.
