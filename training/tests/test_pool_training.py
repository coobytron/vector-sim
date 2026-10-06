from __future__ import annotations

import copy
from pathlib import Path

import numpy as np
import pytest
import torch

from vector_nca.core import load_config
from vector_nca.graph_nca import (
    SENSOR_F,
    SENSOR_K,
    THICKNESS,
    GraphNCA,
    branching_graph,
    branching_parents,
    counter_random,
    fire_mask,
    lesion_centers,
    lesion_region,
    neutral_sensors,
    overflow_loss,
    rollout,
    seed_state,
    target_visible,
)
from vector_nca.m1 import export_weights_json, model_from_config, train
from vector_nca.m1_eval import evaluate_m1
from vector_nca.pool import SamplePool, prepare_batch, select_damage, select_replacement

CONFIG = Path(__file__).parents[1] / "configs" / "m1-pool.yaml"

# createBranchingMorphology(128) parents, produced by running src/organisms/morphology.ts under Node.
TS_BRANCHING_128 = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 2, 18, 19, 20, 21, 22, 23, 24, 5, 26, 27, 28, 29, 30, 31, 32, 33, 8, 35, 36, 37, 38, 39, 40, 41, 42, 43, 11, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 14, 56, 57, 58, 59, 60, 61, 62, 2, 64, 65, 66, 67, 68, 69, 70, 71, 23, 73, 74, 75, 76, 77, 78, 79, 80, 81, 32, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 38, 94, 95, 96, 97, 98, 99, 100, 49, 102, 103, 104, 105, 106, 107, 108, 109, 61, 111, 112, 113, 114, 115, 116, 117, 118, 119, 70, 121, 122, 123, 124, 125, 126]  # noqa: E501


def tiny_config() -> dict:
    config = copy.deepcopy(load_config(CONFIG))
    config["graph"]["slots"] = 32
    config["model"]["hidden_width"] = 16
    t = config["training"]
    t.update({"iterations": 3, "pool_size": 8, "batch_size": 4, "damage_count": 1, "damage_start": 0,
              "rollout_range": [3, 5], "lr_milestones": [2], "log_every": 1})
    return config


def test_counter_random_matches_typescript_prng():
    # Values from src/simulation/prng.ts::counterRandom under Node 22.
    cases = [((12345, 0, 0, 0, 0), 0.9400623452384025), ((12345, 0, 7, 3, 1), 0.11573204025626183),
             ((900001, 0, 127, 4095, 1), 0.3264207043685019), ((2147483646, 0, 5, 10, 2), 0.44906418723985553)]
    for args, expected in cases:
        assert float(counter_random(*args)) == expected


def test_branching_topology_matches_typescript_morphology():
    parents, _ = branching_parents(128)
    assert parents == TS_BRANCHING_128


def test_fire_mask_is_deterministic_and_near_rate():
    first = fire_mask([1, 2, 3], 7, 128, 0.5, 0)
    assert torch.equal(first, fire_mask([1, 2, 3], 7, 128, 0.5, 0))
    assert not torch.equal(first, fire_mask([1, 2, 3], 7, 128, 0.5, 1))
    assert 0.35 < float(first.mean()) < 0.65


def test_pool_replaces_highest_loss_with_seed_ties_to_lower_position():
    losses = torch.tensor([0.1, 0.5, 0.3, 0.5])
    assert select_replacement(losses) == 1
    seed = torch.full((5, 3), 7.0)
    batch = torch.arange(4 * 5 * 3, dtype=torch.float32).reshape(4, 5, 3)
    out, replaced, damaged = prepare_batch(batch, losses, seed, [])
    assert replaced == 1 and damaged == []
    assert torch.equal(out[1], seed)
    for i in (0, 2, 3):
        assert torch.equal(out[i], batch[i])


def test_pool_write_back_updates_only_sampled_entries():
    pool = SamplePool(torch.zeros(4, 2), 6)
    indices = pool.sample(3, np.random.default_rng(0))
    assert len(set(indices.tolist())) == 3
    pool.write_back(indices, torch.ones(3, 4, 2))
    touched = torch.zeros(6, dtype=torch.bool)
    touched[torch.as_tensor(indices)] = True
    assert pool.states[touched].eq(1).all() and pool.states[~touched].eq(0).all()


def test_damage_selects_lowest_loss_never_the_replaced_sample():
    losses = torch.tensor([0.4, 0.05, 0.9, 0.2, 0.05])
    assert select_damage(losses, 2) == [1, 4]
    assert select_damage(losses, 3) == [1, 3, 4]
    # Even if every sample were requested, the replaced (worst) one is never damaged.
    assert 2 not in select_damage(losses, 10)
    graph = branching_graph(32)
    masks = [lesion_region(graph, 7, 0.25)]
    batch = torch.ones(5, 32, 4)
    out, replaced, damaged = prepare_batch(batch, losses, torch.zeros(32, 4), masks)
    assert replaced == 2 and damaged == [1]
    assert out[1, masks[0]].eq(0).all() and out[1, ~masks[0]].eq(1).all()
    assert out[0].eq(1).all() and out[3].eq(1).all() and out[4].eq(1).all()


def test_lesion_region_is_contiguous_quarter_and_held_out_centres_are_disjoint():
    graph = branching_graph(128)
    region = lesion_region(graph, 35, 0.25)
    assert int(region.sum()) == 32
    assert torch.equal(region, lesion_region(graph, 35, 0.25))
    nodes = set(torch.nonzero(region).flatten().tolist())
    reached, frontier = {35}, [35]
    while frontier:
        node = frontier.pop()
        for other in graph.adjacency[node]:
            if other in nodes and other not in reached:
                reached.add(other)
                frontier.append(other)
    assert reached == nodes
    train_c, held_c = set(lesion_centers(graph, False)), set(lesion_centers(graph, True))
    assert train_c.isdisjoint(held_c) and len(train_c | held_c) == 128


def test_overflow_loss_is_zero_inside_bounds_and_linear_outside():
    assert overflow_loss(torch.tensor([-1.0, 0.0, 0.5, 1.0])).item() == 0.0
    value = overflow_loss(torch.tensor([1.5, -3.0, 0.0, 0.0]))
    assert value.item() == pytest.approx((0.5 + 2.0) / 4)
    x = torch.tensor([2.0, -2.0], requires_grad=True)
    overflow_loss(x).backward()
    assert x.grad.tolist() == [0.5, -0.5]


def test_untrained_model_is_a_no_op_and_perception_is_masked_at_root_and_tips():
    graph = branching_graph(32)
    model = GraphNCA(16, 6, 8)
    state = seed_state(2, 32, 16)
    sensors = neutral_sensors(2, 32)
    out = rollout(model, state, sensors, graph, [1, 2], 0, 10, 0)
    assert torch.equal(out, state)
    perception = GraphNCA.perceive(torch.randn(1, 32, 16), sensors[:1], graph)
    assert perception[0, 0, 32:48].abs().sum() == 0  # parent term at root
    tip = int(torch.nonzero(graph.is_tip)[0])
    assert perception[0, tip, 48:64].abs().sum() == 0  # children term at a tip


def test_targets_respond_in_opposite_directions_to_food_and_kill():
    graph = branching_graph(32)
    sensors = neutral_sensors(3, 32)
    sensors[1, :, SENSOR_F] = 0.8
    sensors[2, :, SENSOR_K] = -0.8
    target = target_visible(graph, sensors)[..., THICKNESS]
    assert (target[1] > target[0]).all() and (target[2] < target[0]).all()


def test_seeded_training_is_exactly_repeatable():
    config = tiny_config()
    device = torch.device("cpu")
    model_a, pool_a, hist_a = train(config, device)
    model_b, pool_b, hist_b = train(config, device)
    for key, value in model_a.state_dict().items():
        assert torch.equal(value, model_b.state_dict()[key])
    assert torch.equal(pool_a.states, pool_b.states)
    assert [h["loss"] for h in hist_a] == [h["loss"] for h in hist_b]
    other = copy.deepcopy(config)
    other["seed"] = 1
    model_c, _, _ = train(other, device)
    assert not torch.equal(model_a.w2.weight, model_c.w2.weight)


def test_export_json_and_evaluation_smoke():
    config = tiny_config()
    config["evaluation"].update({"horizons": [8, 16], "held_out_seeds": [5, 6], "held_out_lesion_centers": 2})
    model, _, _ = train(config, torch.device("cpu"))
    graph = branching_graph(32)
    manifest = {"sha256": "x", "training_device": "cpu", "environment": {"torch": torch.__version__},
                "training_seed": 0, "checkpoint_version": "test"}
    export = export_weights_json(model, graph, manifest)
    assert export["tensors"]["w1"]["shape"] == [16, 16 * 4 + 6]
    assert export["tensors"]["w2"]["shape"] == [16, 16]
    assert [f["tick"] for f in export["golden"]["frames"]] == [1, 8, 32]
    baseline = evaluate_m1(model_from_config(config), graph, config, torch.device("cpu"))
    assert baseline["pass"] is False
    assert baseline["per_horizon"]["16"]["recovery_fraction_mean"] == 0.0
    assert set(baseline["checks"]) == {"grows", "opposite_field_response", "recovers_75", "finite",
                                       "bounded_no_upward_trend"}
