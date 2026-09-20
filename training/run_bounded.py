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
from vector_nca.evaluation import evaluate_candidate, preview_sequence, write_preview_svg


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

    for _ in range(train_steps):
        optimizer.zero_grad(set_to_none=True)
        state = model.rollout(latent, sensors, unroll)
        morphology = phenotype_loss(state, positions, target)
        stability = (state - latent).pow(2).mean()
        boundedness = torch.relu(state.abs() - 2.0).pow(2).mean()
        positive = -(state[:, 0] * sensors[:, 0]).mean()
        negative = (state[:, 1] * sensors[:, 1]).mean()
        lesion = (state[lesion_mask] - latent[lesion_mask]).abs().mean()
        weights = config["loss_weights"]
        loss = (
            float(weights["morphology"]) * morphology
            + float(weights["stability"]) * stability
            + float(weights["field_response"]) * (positive + negative)
            + float(weights["recovery"]) * lesion
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
        "metrics": metrics,
        "baseline_metrics": baseline_metrics,
        "delta_vs_untrained": deltas,
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
