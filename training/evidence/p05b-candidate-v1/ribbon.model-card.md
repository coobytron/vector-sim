# Vector NCA model card

- Phenotype: `ribbon`
- Architecture: `vector_nca_mlp_v1`
- Latent channels: 16
- Sensor channels: 6
- Hidden width: 64
- Update rate: 0.25
- Checkpoint version: `p05b-candidate-v1`
- Training seed: 240807
- Checkpoint SHA-256: `06c7fa9286dd9943651c86a4c5ad2bff84ce8305519788df90d23a0608f069bf`

## Metrics

- damage_recovery_delta: 32.06065369
- growth: 32.32589722
- max_abs_state: 91.50227356
- nan_rate: 0.00000000
- negative_field_response: 2.21411157
- phenotype_target_loss: 227.88282776
- positive_field_response: 22.68852425
- stability_error: 1511.69470215

## Limitations

- Candidate checkpoint; production phenotype quality still requires visual and physical-device validation.
- Exact PyTorch floating-point replay is only expected within the pinned environment.
