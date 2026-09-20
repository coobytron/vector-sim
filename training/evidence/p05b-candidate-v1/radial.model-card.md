# Vector NCA model card

- Phenotype: `radial`
- Architecture: `vector_nca_mlp_v1`
- Latent channels: 16
- Sensor channels: 6
- Hidden width: 64
- Update rate: 0.25
- Checkpoint version: `p05b-candidate-v1`
- Training seed: 240807
- Checkpoint SHA-256: `2141649f32eada840f4d1e602a1584e9005619e1feff32f476ae6f0ad6a53cd2`

## Metrics

- damage_recovery_delta: 30.32159615
- growth: 32.57128525
- max_abs_state: 85.61956787
- nan_rate: 0.00000000
- negative_field_response: 1.08959448
- phenotype_target_loss: 416.35070801
- positive_field_response: 17.89466858
- stability_error: 1496.71398926

## Limitations

- Candidate checkpoint; production phenotype quality still requires visual and physical-device validation.
- Exact PyTorch floating-point replay is only expected within the pinned environment.
