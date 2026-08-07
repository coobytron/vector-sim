from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from vector_nca.core import PHENOTYPES, VectorNCA, build_fixture, evaluate_state, load_config, save_checkpoint, seed_everything


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="training/configs/reference.yaml")
    parser.add_argument("--phenotype", choices=sorted(PHENOTYPES), default=None)
    parser.add_argument("--out", default="training/output/reference-smoke.pt")
    args = parser.parse_args()

    config = load_config(args.config)
    if args.phenotype:
        config["phenotype"] = args.phenotype
    target = PHENOTYPES[config["phenotype"]]
    seed_everything(int(config["seed"]))
    fixture = build_fixture(config)

    model = VectorNCA(
        latent_channels=int(config["model"]["latent_channels"]),
        sensor_channels=int(config["model"]["sensor_channels"]),
        hidden_width=int(config["model"]["hidden_width"]),
        update_rate=float(config["model"]["update_rate"]),
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=float(config["training"]["learning_rate"]))

    latent = fixture["latent"]
    sensors = fixture["sensors"]
    positions = fixture["positions"]
    lesion_mask = fixture["lesion_mask"]
    steps = int(config["training"]["unroll_steps"])

    for _ in range(int(config["training"]["smoke_steps"])):
        optimizer.zero_grad(set_to_none=True)
        final = model.rollout(latent, sensors, steps)
        morphology = (final[:, :3] - positions).pow(2).mean()
        stability = (final - latent).pow(2).mean()
        field_response = -(final[:, 0] * sensors[:, 0]).mean() + (final[:, 1] * sensors[:, 1]).mean()
        recovery = final[lesion_mask].abs().mean()
        boundedness = torch.relu(final.abs() - 4.0).mean()
        weights = config["loss_weights"]
        loss = (
            morphology * float(weights["morphology"])
            + stability * float(weights["stability"])
            + field_response * float(weights["field_response"])
            + recovery * float(weights["recovery"])
            + boundedness * float(weights["boundedness"])
        )
        loss.backward()
        optimizer.step()

    with torch.no_grad():
        final = model.rollout(latent, sensors, steps)
        metrics = evaluate_state(latent, final, sensors, lesion_mask, positions, target)
        metrics["smoke_loss"] = float(loss.item())

    manifest = save_checkpoint(args.out, model, config, target, metrics)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
