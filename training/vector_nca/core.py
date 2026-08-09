from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any
import json
import random

import numpy as np
import torch
from torch import nn
import yaml


@dataclass(frozen=True)
class PhenotypeTarget:
    name: str
    radial_bias: float
    branch_bias: float
    ribbon_bias: float


PHENOTYPES = {
    "branching": PhenotypeTarget("branching", radial_bias=0.15, branch_bias=1.0, ribbon_bias=0.25),
    "ribbon": PhenotypeTarget("ribbon", radial_bias=0.15, branch_bias=0.2, ribbon_bias=1.0),
    "radial": PhenotypeTarget("radial", radial_bias=1.0, branch_bias=0.35, ribbon_bias=0.2),
}


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)


def load_config(path: str | Path) -> dict[str, Any]:
    return yaml.safe_load(Path(path).read_text())


def build_fixture(config: dict[str, Any]) -> dict[str, torch.Tensor]:
    seed = int(config["seed"])
    seed_everything(seed)
    nodes = int(config["training"]["nodes"])
    latent_channels = int(config["model"]["latent_channels"])
    sensor_channels = int(config["model"]["sensor_channels"])

    latent = torch.zeros((nodes, latent_channels), dtype=torch.float32)
    latent[:, 0] = torch.linspace(-1.0, 1.0, nodes)
    latent[:, 1] = torch.sin(torch.linspace(0.0, torch.pi * 2.0, nodes))

    sensors = torch.zeros((nodes, sensor_channels), dtype=torch.float32)
    sensors[:, 0] = float(config["fixtures"]["positive_field"])
    sensors[:, 1] = float(config["fixtures"]["negative_field"])
    sensors[:, 2] = torch.linspace(-1.0, 1.0, nodes)
    sensors[:, 3] = 1.0 - torch.abs(sensors[:, 2])
    sensors[:, 4] = 1.0
    sensors[:, 5] = 0.0

    lesion_fraction = float(config["fixtures"]["lesion_fraction"])
    lesion_count = max(1, round(nodes * lesion_fraction))
    lesion_mask = torch.zeros(nodes, dtype=torch.bool)
    start = (nodes - lesion_count) // 2
    lesion_mask[start : start + lesion_count] = True

    positions = torch.stack(
        [torch.linspace(-1.0, 1.0, nodes), torch.zeros(nodes), torch.zeros(nodes)], dim=1
    )
    return {"latent": latent, "sensors": sensors, "lesion_mask": lesion_mask, "positions": positions}


class VectorNCA(nn.Module):
    def __init__(self, latent_channels: int, sensor_channels: int, hidden_width: int, update_rate: float = 0.5):
        super().__init__()
        self.latent_channels = latent_channels
        self.sensor_channels = sensor_channels
        self.hidden_width = hidden_width
        self.update_rate = update_rate
        width = latent_channels * 2 + sensor_channels
        self.net = nn.Sequential(
            nn.Linear(width, hidden_width),
            nn.Tanh(),
            nn.Linear(hidden_width, latent_channels),
            nn.Tanh(),
        )

    def forward(self, latent: torch.Tensor, sensors: torch.Tensor) -> torch.Tensor:
        neighbor = torch.roll(latent, shifts=1, dims=0)
        delta = self.net(torch.cat([latent, neighbor, sensors], dim=-1))
        return latent + delta * self.update_rate

    def rollout(self, latent: torch.Tensor, sensors: torch.Tensor, steps: int) -> torch.Tensor:
        state = latent
        for _ in range(steps):
            state = self(state, sensors)
        return state


def phenotype_loss(state: torch.Tensor, positions: torch.Tensor, target: PhenotypeTarget) -> torch.Tensor:
    magnitude = state[:, :3].pow(2).sum(dim=1).sqrt().mean()
    continuity = (state[1:, :3] - state[:-1, :3]).pow(2).mean()
    center = state[:, :3].mean(dim=0).pow(2).sum().sqrt()
    return (
        target.branch_bias * continuity
        + target.ribbon_bias * torch.abs(magnitude - 0.5)
        + target.radial_bias * center
    )


def evaluate_state(
    initial: torch.Tensor,
    final: torch.Tensor,
    sensors: torch.Tensor,
    lesion_mask: torch.Tensor,
    positions: torch.Tensor,
    target: PhenotypeTarget,
) -> dict[str, float]:
    finite = torch.isfinite(final).all().item()
    growth = float((final.abs().mean() - initial.abs().mean()).item())
    stability = float((final - initial).pow(2).mean().item())
    positive_response = float((final[:, 0] * sensors[:, 0]).mean().item())
    negative_response = float((-final[:, 1] * sensors[:, 1]).mean().item())
    lesion_delta = (final[lesion_mask] - initial[lesion_mask]).abs().mean()
    bounded = float(final.abs().max().item())
    target_score = float(phenotype_loss(final, positions, target).item())
    return {
        "growth": growth,
        "stability_error": stability,
        "positive_field_response": positive_response,
        "negative_field_response": negative_response,
        "damage_recovery_delta": float(lesion_delta.item()),
        "max_abs_state": bounded,
        "nan_rate": 0.0 if finite else 1.0,
        "phenotype_target_loss": target_score,
    }


def save_checkpoint(
    path: str | Path,
    model: VectorNCA,
    config: dict[str, Any],
    phenotype: PhenotypeTarget,
    metrics: dict[str, float],
) -> dict[str, Any]:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), path)
    checksum = sha256(path.read_bytes()).hexdigest()
    checkpoint_version = str(config.get("checkpoint_version", "p05a-smoke-v1"))
    is_smoke = checkpoint_version.startswith("p05a-smoke")
    limitations = [
        "Exact PyTorch floating-point replay is only expected within the pinned environment.",
    ]
    if is_smoke:
        limitations.insert(0, "Smoke-training scaffold only; phenotype quality is not production validated.")
    else:
        limitations.insert(0, "Candidate checkpoint; production phenotype quality still requires visual and physical-device validation.")
    manifest = {
        "schema_version": 1,
        "architecture": "vector_nca_mlp_v1",
        "phenotype": phenotype.name,
        "latent_channels": model.latent_channels,
        "sensor_channels": model.sensor_channels,
        "hidden_width": model.hidden_width,
        "update_rate": float(model.update_rate),
        "dtype": "float32",
        "checkpoint_version": checkpoint_version,
        "sha256": checksum,
        "training_seed": int(config["seed"]),
        "metrics": metrics,
        "limitations": limitations,
        "intended_use": "P05 training development and P06 browser-export contract validation",
    }
    manifest_path = path.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    card = path.with_suffix(".model-card.md")
    card.write_text(
        "# Vector NCA model card\n\n"
        f"- Phenotype: `{phenotype.name}`\n"
        f"- Architecture: `vector_nca_mlp_v1`\n"
        f"- Latent channels: {model.latent_channels}\n"
        f"- Sensor channels: {model.sensor_channels}\n"
        f"- Hidden width: {model.hidden_width}\n"
        f"- Update rate: {model.update_rate}\n"
        f"- Checkpoint version: `{checkpoint_version}`\n"
        f"- Training seed: {config['seed']}\n"
        f"- Checkpoint SHA-256: `{checksum}`\n\n"
        "## Metrics\n\n"
        + "\n".join(f"- {key}: {value:.8f}" for key, value in sorted(metrics.items()))
        + "\n\n## Limitations\n\n"
        + "\n".join(f"- {item}" for item in limitations)
        + "\n"
    )
    return manifest
