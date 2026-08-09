from __future__ import annotations

import copy
from pathlib import Path

from run_bounded import train_one
from vector_nca.core import load_config


CONFIG_PATH = Path(__file__).parents[1] / "configs" / "p05b.yaml"


def tiny_config():
    config = copy.deepcopy(load_config(CONFIG_PATH))
    config["training"]["train_steps"] = 2
    config["training"]["evaluation_steps"] = 8
    config["training"]["nodes"] = 16
    return config


def test_bounded_training_is_repeatable(tmp_path):
    config = tiny_config()
    first = train_one(config, "branching", tmp_path / "first")
    second = train_one(config, "branching", tmp_path / "second")
    assert first["metrics"] == second["metrics"]
    assert first["baseline_metrics"] == second["baseline_metrics"]
    assert first["delta_vs_untrained"] == second["delta_vs_untrained"]
    assert first["manifest"]["sha256"] == second["manifest"]["sha256"]


def test_all_phenotypes_emit_evaluation_reports(tmp_path):
    config = tiny_config()
    for phenotype in ("branching", "ribbon", "radial"):
        report = train_one(config, phenotype, tmp_path / phenotype)
        assert report["phenotype"] == phenotype
        assert report["evaluation_steps"] == 8
        assert report["metrics"]["nan_rate"] == 0.0
        assert (tmp_path / phenotype / f"{phenotype}.evaluation.json").exists()
        assert (tmp_path / phenotype / f"{phenotype}.manifest.json").exists()
        assert (tmp_path / phenotype / f"{phenotype}.model-card.md").exists()
