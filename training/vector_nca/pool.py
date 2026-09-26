"""Sample-pool bookkeeping for M1 (Growing NCA, Distill 2020, adapted to graphs)."""
from __future__ import annotations

import numpy as np
import torch

from .graph_nca import SENSOR_F, SENSOR_K, Graph, lesion_region, neutral_sensors


class SamplePool:
    """Fixed-size pool of evolved graph states, initialised with seeds."""

    def __init__(self, seed: torch.Tensor, size: int):
        if seed.ndim != 2:
            raise ValueError("seed must be (nodes, channels)")
        self.seed = seed.clone()
        self.states = seed[None].repeat(size, 1, 1)

    def __len__(self) -> int:
        return self.states.shape[0]

    def sample(self, batch: int, rng: np.random.Generator) -> np.ndarray:
        return np.sort(rng.choice(len(self), size=batch, replace=False))

    def write_back(self, indices: np.ndarray, states: torch.Tensor) -> None:
        self.states[torch.as_tensor(indices)] = states.detach().to(self.states.device, self.states.dtype)


def order_by_loss(losses: torch.Tensor) -> list[int]:
    """Batch positions sorted by descending loss; ties resolved by lower position first."""
    values = losses.detach().cpu().tolist()
    return sorted(range(len(values)), key=lambda i: (-values[i], i))


def select_replacement(losses: torch.Tensor) -> int:
    """Batch position of the highest-loss sample (replaced by a fresh seed)."""
    return order_by_loss(losses)[0]


def select_damage(losses: torch.Tensor, count: int) -> list[int]:
    """Batch positions of the ``count`` lowest-loss samples, never the replaced one."""
    replaced = select_replacement(losses)
    values = losses.detach().cpu().tolist()
    ascending = sorted((i for i in range(len(values)) if i != replaced), key=lambda i: (values[i], i))
    return sorted(ascending[:count])


def prepare_batch(batch: torch.Tensor, losses: torch.Tensor, seed: torch.Tensor, damage_masks: list[torch.Tensor]) -> tuple[torch.Tensor, int, list[int]]:
    """Replace the worst sample with the seed and lesion the best ``len(damage_masks)``."""
    batch = batch.clone()
    replaced = select_replacement(losses)
    batch[replaced] = seed
    damaged = select_damage(losses, len(damage_masks))
    for position, mask in zip(damaged, damage_masks):
        batch[position, mask.to(batch.device)] = 0.0
    return batch, replaced, damaged


def sample_training_lesions(graph: Graph, rng: np.random.Generator, count: int, fraction: float, centers: list[int]) -> list[torch.Tensor]:
    return [lesion_region(graph, int(centers[rng.integers(len(centers))]), fraction) for _ in range(count)]


def sample_fields(graph: Graph, rng: np.random.Generator, batch: int, sensor_channels: int,
                  probabilities: dict[str, float], amplitude: tuple[float, float],
                  local_fraction: tuple[float, float]) -> torch.Tensor:
    """Per-sample field scenario: neutral, uniform F/K, or a local F/K patch."""
    kinds = ["neutral", "food", "kill", "food_local", "kill_local"]
    weights = np.array([float(probabilities.get(kind, 0.0)) for kind in kinds])
    weights = weights / weights.sum()
    sensors = neutral_sensors(batch, graph.nodes, sensor_channels)
    for b in range(batch):
        kind = kinds[int(rng.choice(len(kinds), p=weights))]
        if kind == "neutral":
            continue
        value = float(rng.uniform(*amplitude))
        if kind.endswith("local"):
            center = int(rng.integers(graph.nodes))
            region = lesion_region(graph, center, float(rng.uniform(*local_fraction)))
        else:
            region = torch.ones(graph.nodes, dtype=torch.bool)
        if kind.startswith("food"):
            sensors[b, region, SENSOR_F] = value
        else:
            sensors[b, region, SENSOR_K] = -value
    return sensors
