from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import torch

from vector_nca.core import (
    PHENOTYPES,
    VectorNCA,
    build_fixture,
    load_config,
    phenotype_loss,
    save_checkpoint,
    seed_everything,
)
from vector_nca.evaluation import (
    controlled_sensor_scenarios,
    evaluate_candidate,
    preview_sequence,
    write_preview_svg,
)
from vector_nca.objectives import lesion_recovery_loss


def train_one(config: dict, phenotype_name: str, out_dir: Path) -> dict:
    config = copy.deepcopy(config)
    config["phenotype"] = phenotype_name
    seed = int(config["seed"])
    seed_everything(seed)
    target = PHENOTYPES[phenotype_name]
    fixture = build_fixture(config)

    model = VectorNCA(
        int(config["model"]["latent_channels"]),
        int(config["model"]["sensor_channels"]),
        int(config["model"]["hidden_width"]),
        float(config["model"]["update_rate"]),
    )
    baseline = copy.deepcopy(model)
    optimizer = torch.optim.Adam(model.parameters(), lr=float(config["training"]["learning_rate"]))
    train_steps = int(config["training"].get("train_steps", 64))
    unroll = int(config["training"]["unroll_steps"])

    latent = fixture["latent"]
    sensors = fixture["sensors"]
    positions = fixture["positions"]
    lesion_mask = fixture["lesion_mask"]

    neutral_sensors, positive_sensors, negative_sensors = controlled_sensor_scenarios(sensors)
    field_margin = float(config["training"].get("field_response_margin", 0.05))
    cross_penalty = float(config["training"].get("cross_response_penalty", 0.1))
    recovery_pre_steps = int(config["training"].get("recovery_pre_steps", max(1, unroll // 2)))
    recovery_steps = int(config["training"].get("recovery_steps", max(1, unroll - recovery_pre_steps)))
    recovery_target_fraction = float(config["training"].get("recovery_target_fraction", 0.75))
    if recovery_pre_steps < 1 or recovery_steps < 1:
        raise ValueError("recovery_pre_steps and recovery_steps must be >= 1")
    if not 0.0 < recovery_target_fraction < 1.0:
        raise ValueError("recovery_target_fraction must be within (0, 1)")

    for _ in range(train_steps):
        optimizer.zero_grad(set_to_none=True)

        neutral_state = model.rollout(latent, neutral_sensors, unroll)
        positive_state = model.rollout(latent, positive_sensors, unroll)
        negative_state = model.rollout(latent, negative_sensors, unroll)

        morphology = phenotype_loss(neutral_state, positions, target)
        stability = (neutral_state - latent).pow(2).mean()
        boundedness = torch.stack(
            [
                torch.relu(neutral_state.abs() - 2.0).pow(2).mean(),
                torch.relu(positive_state.abs() - 2.0).pow(2).mean(),
                torch.relu(negative_state.abs() - 2.0).pow(2).mean(),
            ]
        ).mean()

        positive_activation = (positive_state[:, 0] - neutral_state[:, 0]).mean()
        negative_activation = (negative_state[:, 1] - neutral_state[:, 1]).mean()
        cross_response = (
            (positive_state[:, 1] - neutral_state[:, 1]).abs().mean()
            + (negative_state[:, 0] - neutral_state[:, 0]).abs().mean()
        )
        field_response = (
            torch.relu(neutral_state.new_tensor(field_margin) - positive_activation)
            + torch.relu(neutral_state.new_tensor(field_margin) - negative_activation)
            + cross_penalty * cross_response
        )

        with torch.no_grad():
            pre_lesion = model.rollout(latent, neutral_sensors, recovery_pre_steps)
        recovery = lesion_recovery_loss(
            model,
            pre_lesion,
            neutral_sensors,
            lesion_mask,
            recovery_steps,
            recovery_target_fraction,
        )

        weights = config["loss_weights"]
        loss = (
            float(weights["morphology"]) * morphology
            + float(weights["stability"]) * stability
            + float(weights["field_response"]) * field_response
            + float(weights["recovery"]) * recovery
            + float(weights["boundedness"]) * boundedness
        )
        loss.backward()
        optimizer.step()

    horizon = int(config["training"].get("evaluation_steps", max(256, unroll * 8)))
    metrics = evaluate_candidate(
        model,
        latent,
        sensors,
        lesion_mask,
        positions,
        target,
        horizon,
    )
    baseline_metrics = evaluate_candidate(
        baseline,
        latent,
        sensors,
        lesion_mask,
        positions,
        target,
        horizon,
    )
    deltas = {key: metrics[key] - baseline_metrics[key] for key in metrics}
    preview = preview_sequence(model, latent, sensors, horizon)

    out_dir.mkdir(parents=True, exist_ok=True)
    preview_json = out_dir / f"{phenotype_name}.preview.json"
    preview_svg = out_dir / f"{phenotype_name}.preview.svg"
    preview_json.write_text(json.dumps({"frames": preview}, indent=2, sort_keys=True) + "\n")
    write_preview_svg(preview_svg, preview)
    checkpoint = out_dir / f"{phenotype_name}.pt"
    manifest = save_checkpoint(checkpoint, model, config, target, metrics)
    report = {
        "phenotype": phenotype_name,
        "seed": seed,
        "train_steps": train_steps,
        "evaluation_steps": horizon,
        "recovery_training": {
            "pre_steps": recovery_pre_steps,
            "steps": recovery_steps,
            "target_fraction": recovery_target_fraction,
        },
        "metrics": metrics,
        "baseline_metrics": baseline_metrics,
        "delta_vs_untrained": deltas,
        "training_objective": "controlled-field-lesion-v4-paired-gradient",
        "evaluation_protocol": "controlled-field-lesion-v2",
        "preview_json": preview_json.name,
        "preview_svg": preview_svg.name,
        "manifest": manifest,
    }
    (out_dir / f"{phenotype_name}.evaluation.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="training/configs/reference.yaml")
    parser.add_argument("--phenotype", choices=[*PHENOTYPES, "all"], default="all")
    parser.add_argument("--out", default="training/artifacts/p05b")
    args = parser.parse_args()

    config = load_config(args.config)
    names = list(PHENOTYPES) if args.phenotype == "all" else [args.phenotype]
    reports = [train_one(config, name, Path(args.out)) for name in names]
    print(json.dumps({"reports": reports}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
