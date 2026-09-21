"""Record out-of-training-horizon and changed-lesion evidence without promotion."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from vector_nca.core import PHENOTYPES, VectorNCA, build_fixture, load_config
from vector_nca.evaluation import evaluate_candidate


def evaluate_stress(config: dict, checkpoint_dir: Path) -> dict:
    fixture = build_fixture(config)
    horizon = int(config["training"]["evaluation_steps"])
    fraction = float(config["fixtures"]["lesion_fraction"])
    scenarios = [(horizon, fraction / 2), (horizon, fraction * 1.5),
                 (horizon * 2, fraction), (horizon * 4, fraction)]
    reports = []
    for name, target in PHENOTYPES.items():
        model = VectorNCA(**config["model"])
        model.load_state_dict(torch.load(checkpoint_dir / f"{name}.pt", weights_only=True))
        for ticks, lesion_fraction in scenarios:
            mask = torch.zeros_like(fixture["lesion_mask"])
            count = max(1, min(len(mask), round(len(mask) * lesion_fraction)))
            start = (len(mask) - count) // 2
            mask[start:start + count] = True
            metrics = evaluate_candidate(model, fixture["latent"], fixture["sensors"],
                                         mask, fixture["positions"], target, ticks)
            reports.append({"phenotype": name, "horizon": ticks,
                            "lesion_fraction": count / len(mask), "metrics": metrics})
    return {"evaluation_protocol": "controlled-field-lesion-v2",
            "purpose": "stress evidence; no automatic checkpoint promotion", "reports": reports}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="training/configs/p05b.yaml")
    parser.add_argument("--checkpoints", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    report = evaluate_stress(load_config(args.config), args.checkpoints)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
