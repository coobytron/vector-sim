from __future__ import annotations

import torch

from .core import VectorNCA


def lesion_recovery_loss(
    model: VectorNCA,
    pre_lesion: torch.Tensor,
    sensors: torch.Tensor,
    lesion_mask: torch.Tensor,
    steps: int,
    target_fraction: float,
) -> torch.Tensor:
    """Train contraction of a lesion against the same evolving intact model.

    Freeze the common starting state and damage budget, not the intact rollout.
    Both final states depend on the weights: dropping the intact derivative
    rewards shared drift even when it cannot reduce the counterfactual gap.
    """
    intact_seed = pre_lesion.detach()
    lesioned_seed = intact_seed.clone()
    lesioned_seed[lesion_mask] = 0.0
    intact = model.rollout(intact_seed, sensors, steps)
    recovered = model.rollout(lesioned_seed, sensors, steps)
    immediate_damage = (intact_seed[lesion_mask] - lesioned_seed[lesion_mask]).abs().mean()
    difference = recovered[lesion_mask] - intact[lesion_mask]
    margin = torch.relu(difference.abs().mean() - immediate_damage * target_fraction)
    return difference.pow(2).mean() + margin
