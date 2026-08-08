from __future__ import annotations

import json
from pathlib import Path

import torch

from vector_nca.core import PHENOTYPES, VectorNCA, build_fixture, evaluate_state, load_config, save_checkpoint, seed_everything


CONFIG_PATH = Path(__file__).parents[1] / "configs" / "reference.yaml"


def make_model(config):
    return VectorNCA(
        latent_channels=int(config["model"]["latent_channels"]),
        sensor_channels=int(config["model"]["sensor_channels"]),
        hidden_width=int(config["model"]["hidden_width"]),
        update_rate=float(config["model"]["update_rate"]),
    )


def test_fixture_generation_is_exactly_repeatable():
    config = load_config(CONFIG_PATH)
    first = build_fixture(config)
    second = build_fixture(config)
    for key in first:
        assert torch.equal(first[key], second[key])
    assert first["sensors"][:, 0].gt(0).all()
    assert first["sensors"][:, 1].lt(0).all()
    assert first["lesion_mask"].any()


def test_rollout_is_repeatable_for_same_seed():
    config = load_config(CONFIG_PATH)
    fixture = build_fixture(config)
    seed_everything(int(config["seed"]))
    first = make_model(config)
    first_state = first.rollout(fixture["latent"], fixture["sensors"], 4)
    seed_everything(int(config["seed"]))
    second = make_model(config)
    second_state = second.rollout(fixture["latent"], fixture["sensors"], 4)
    assert torch.equal(first_state, second_state)


def test_all_phenotypes_share_one_contract_and_report_metrics():
    config = load_config(CONFIG_PATH)
    fixture = build_fixture(config)
    seed_everything(int(config["seed"]))
    model = make_model(config)
    final = model.rollout(fixture["latent"], fixture["sensors"], 2)
    required = {
        "growth",
        "stability_error",
        "positive_field_response",
        "negative_field_response",
        "damage_recovery_delta",
        "max_abs_state",
        "nan_rate",
        "phenotype_target_loss",
    }
    for target in PHENOTYPES.values():
        metrics = evaluate_state(
            fixture["latent"], final, fixture["sensors"], fixture["lesion_mask"], fixture["positions"], target
        )
        assert required.issubset(metrics)
        assert metrics["nan_rate"] == 0.0


def test_checkpoint_manifest_and_model_card_round_trip(tmp_path):
    config = load_config(CONFIG_PATH)
    fixture = build_fixture(config)
    seed_everything(int(config["seed"]))
    model = make_model(config)
    final = model.rollout(fixture["latent"], fixture["sensors"], 2)
    metrics = evaluate_state(
        fixture["latent"], final, fixture["sensors"], fixture["lesion_mask"], fixture["positions"], PHENOTYPES["branching"]
    )
    checkpoint = tmp_path / "smoke.pt"
    manifest = save_checkpoint(checkpoint, model, config, PHENOTYPES["branching"], metrics)
    disk_manifest = json.loads(checkpoint.with_suffix(".manifest.json").read_text())
    assert manifest == disk_manifest
    assert len(manifest["sha256"]) == 64
    assert manifest["architecture"] == "vector_nca_mlp_v1"
    assert manifest["dtype"] == "float32"
    assert checkpoint.with_suffix(".model-card.md").exists()
    restored = make_model(config)
    restored.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
