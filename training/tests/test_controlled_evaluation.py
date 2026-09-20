from __future__ import annotations

import copy
from pathlib import Path

import torch

from vector_nca.core import PHENOTYPES, VectorNCA, build_fixture, load_config, seed_everything
from vector_nca.evaluation import (
    controlled_sensor_scenarios,
    evaluate_candidate,
    preview_sequence,
    write_preview_svg,
)


CONFIG_PATH = Path(__file__).parents[1] / "configs" / "p05b.yaml"


def fixture_model():
    config = copy.deepcopy(load_config(CONFIG_PATH))
    config["training"]["nodes"] = 12
    seed_everything(int(config["seed"]))
    model = VectorNCA(
        int(config["model"]["latent_channels"]),
        int(config["model"]["sensor_channels"]),
        12,
        float(config["model"]["update_rate"]),
    )
    return config, model, build_fixture(config)


def test_controlled_scenarios_isolate_positive_and_negative_channels():
    _config, _model, fixture = fixture_model()
    neutral, positive, negative = controlled_sensor_scenarios(fixture["sensors"])
    assert torch.all(neutral[:, 0] == 0)
    assert torch.all(neutral[:, 1] == 0)
    assert torch.all(positive[:, 0] != 0)
    assert torch.all(positive[:, 1] == 0)
    assert torch.all(negative[:, 0] == 0)
    assert torch.all(negative[:, 1] != 0)


def test_evaluation_applies_a_real_lesion_and_reports_controlled_metrics():
    config, model, fixture = fixture_model()
    metrics = evaluate_candidate(
        model,
        fixture["latent"],
        fixture["sensors"],
        fixture["lesion_mask"],
        fixture["positions"],
        PHENOTYPES["branching"],
        16,
    )
    assert set(
        [
            "growth",
            "stability_error",
            "positive_field_response",
            "negative_field_response",
            "field_contrast",
            "damage_recovery_delta",
            "damage_recovery_fraction",
            "damage_recovery_error",
            "max_abs_state",
            "nan_rate",
            "phenotype_target_loss",
        ]
    ).issubset(metrics)
    assert metrics["positive_field_response"] >= 0
    assert metrics["negative_field_response"] >= 0
    assert metrics["field_contrast"] >= 0
    assert metrics["damage_recovery_error"] >= 0
    assert metrics["nan_rate"] == 0
    assert config["training"]["evaluation_steps"] >= 16


def test_preview_sequence_is_deterministic_and_svg_is_source_stable(tmp_path):
    _config, first_model, fixture = fixture_model()
    seed_everything(240807)
    second_model = copy.deepcopy(first_model)

    first = preview_sequence(first_model, fixture["latent"], fixture["sensors"], 16)
    second = preview_sequence(second_model, fixture["latent"], fixture["sensors"], 16)
    assert first == second
    assert first[0]["tick"] == 0
    assert first[-1]["tick"] == 16
    assert all(len(frame["sha256"]) == 64 for frame in first)

    first_path = tmp_path / "first.svg"
    second_path = tmp_path / "second.svg"
    write_preview_svg(first_path, first)
    write_preview_svg(second_path, second)
    assert first_path.read_bytes() == second_path.read_bytes()
    assert b"<polyline" in first_path.read_bytes()
