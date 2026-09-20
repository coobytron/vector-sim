# Vector NCA model card

- Phenotype: `branching`
- Architecture: `vector_nca_mlp_v1`
- Latent channels: 16
- Sensor channels: 6
- Hidden width: 64
- Update rate: 0.25
- Checkpoint version: `p05b-candidate-v1`
- Training seed: 240807
- Checkpoint SHA-256: `a60bc28efe5751d6aa05cdafadd65fcd6a3adf4e5db259564b333f4946a64197`

## Metrics

- damage_recovery_delta: 45.24161530
- growth: 43.92742538
- max_abs_state: 106.50061035
- nan_rate: 0.00000000
- negative_field_response: 44.41078949
- phenotype_target_loss: 87.53952026
- positive_field_response: 79.24784851
- stability_error: 2544.26318359

## Limitations

- Candidate checkpoint; production phenotype quality still requires visual and physical-device validation.
- Exact PyTorch floating-point replay is only expected within the pinned environment.
