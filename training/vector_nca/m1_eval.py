"""M1 exit-test evaluation (ROADMAP.md, milestone M1), on held-out seeds and lesions.

Criteria are fixed here, before any trained result is inspected, and are not
tuned afterwards:

* grows: at every horizon, mean alive coverage (alive channel >= 0.5) >= 0.90 and
  mean growth progress ``1 - visible_mse / seed_visible_mse`` >= 0.80;
* fields: at every horizon, the mean thickness response to a uniform food field
  (F = +0.8) is >= +0.05 and to a uniform kill field (K = -0.8) is <= -0.05,
  both relative to the neutral rollout with the same fire seed;
* recovers: at every horizon H, a 25% contiguous lesion applied at tick H/2 on a
  held-out centre, then H/2 ticks of repair, gives mean recovery fraction
  ``1 - E_final / E_immediate`` >= 0.75, where E is the mean absolute visible
  channel difference on the lesioned nodes versus the intact rollout with the
  same fire seed (the lesion is the only difference between the two);
* bounded: every state finite, and max|state| over ticks (2048, 4096] is at most
  1.1 x max|state| over ticks (512, 1024] (no upward trend).

Held-out: fire-mask seeds come from a different counterRandom stream than
training (stream 1 vs 0) and from explicit held-out seed values; lesion centres
are nodes with ``index % 4 == 3``, which training never uses.
"""
from __future__ import annotations

from typing import Any

import torch

from .graph_nca import (
    ALIVE,
    SENSOR_F,
    SENSOR_K,
    THICKNESS,
    VISIBLE_CHANNELS,
    Graph,
    GraphNCA,
    fire_mask,
    lesion_centers,
    lesion_region,
    neutral_sensors,
    rollout,
    seed_state,
    target_visible,
    visible_error,
)
from .m1 import EVAL_STREAM

CRITERIA = {
    "alive_coverage_min": 0.90,
    "growth_progress_min": 0.80,
    "field_response_min": 0.05,
    "recovery_fraction_min": 0.75,
    "max_abs_trend_ratio_max": 1.10,
}


def held_out_centers(graph: Graph, count: int) -> list[int]:
    centers = lesion_centers(graph, held_out=True)
    if count >= len(centers):
        return centers
    step = len(centers) / count
    return [centers[int(i * step + step / 2)] for i in range(count)]


def evaluate_m1(model: GraphNCA, graph: Graph, config: dict[str, Any], device: torch.device) -> dict[str, Any]:
    ev = config["evaluation"]
    horizons = sorted(int(h) for h in ev["horizons"])
    seeds = [int(s) for s in ev["held_out_seeds"]]
    centers = held_out_centers(graph, int(ev["held_out_lesion_centers"]))
    fraction = float(ev["lesion_fraction"])
    amplitude = float(ev["field_amplitude"])
    n, c, s_count = graph.nodes, model.channels, len(seeds)
    dgraph = graph.to(device)
    model = model.to(device).eval()

    # Main batch: [neutral x S, food x S, kill x S], fire seeds repeat per scenario.
    sensors = neutral_sensors(3 * s_count, n, model.sensor_channels)
    sensors[s_count:2 * s_count, :, SENSOR_F] = amplitude
    sensors[2 * s_count:, :, SENSOR_K] = -amplitude
    main_seeds = seeds * 3
    target = target_visible(graph, sensors)
    seed_err = visible_error(seed_state(1, n, c), target[:1])[0].item()
    snapshots: dict[int, torch.Tensor] = {}
    wanted = set(horizons) | {h // 2 for h in horizons}
    max_abs_per_tick: list[float] = []
    finite = True

    state = seed_state(3 * s_count, n, c).to(device)
    dsensors = sensors.to(device)
    with torch.no_grad():
        for tick in range(horizons[-1]):
            mask = fire_mask(main_seeds, tick, n, model.fire_rate, EVAL_STREAM).to(device)
            state = model.step(state, dsensors, dgraph, mask)
            max_abs_per_tick.append(float(state.abs().max().item()))
            if tick + 1 in wanted:
                snapshots[tick + 1] = state.cpu().clone()
                finite = finite and bool(torch.isfinite(state).all().item())

        lesion_max: dict[int, float] = {}
        recovery: dict[int, dict[str, Any]] = {}
        masks = [lesion_region(graph, center, fraction) for center in centers]
        for h in horizons:
            start = h // 2
            pre = snapshots[start][:s_count]  # neutral, per seed
            intact = snapshots[h][:s_count]
            lesioned = pre.repeat_interleave(len(centers), dim=0)
            batch_masks = torch.stack(masks * s_count)  # (S*L, N), seed-major
            lesioned[batch_masks] = 0.0
            branch_seeds = [seed for seed in seeds for _ in centers]
            recovered = rollout(model, lesioned.to(device), neutral_sensors(len(branch_seeds), n, model.sensor_channels).to(device),
                                dgraph, branch_seeds, start, h - start, EVAL_STREAM).cpu()
            finite = finite and bool(torch.isfinite(recovered).all().item())
            lesion_max[h] = float(recovered.abs().max().item())
            ref_pre = pre.repeat_interleave(len(centers), dim=0)
            ref_intact = intact.repeat_interleave(len(centers), dim=0)
            fractions, fractions_all, target_err = [], [], []
            neutral_target = target_visible(graph, neutral_sensors(1, n, model.sensor_channels))[0]
            for i in range(len(branch_seeds)):
                m = batch_masks[i]
                e0 = (lesioned[i, m, :VISIBLE_CHANNELS] - ref_pre[i, m, :VISIBLE_CHANNELS]).abs().mean().item()
                e1 = (recovered[i, m, :VISIBLE_CHANNELS] - ref_intact[i, m, :VISIBLE_CHANNELS]).abs().mean().item()
                a0 = (lesioned[i, m] - ref_pre[i, m]).abs().mean().item()
                a1 = (recovered[i, m] - ref_intact[i, m]).abs().mean().item()
                # No damage to undo (nothing alive in the region) counts as no recovery.
                fractions.append(1.0 - e1 / e0 if e0 > 1e-6 else 0.0)
                fractions_all.append(1.0 - a1 / a0 if a0 > 1e-6 else 0.0)
                target_err.append((recovered[i, m, :VISIBLE_CHANNELS] - neutral_target[m]).pow(2).mean().item())
            recovery[h] = {
                "lesion_tick": start,
                "recovery_fraction_mean": sum(fractions) / len(fractions),
                "recovery_fraction_min": min(fractions),
                "recovery_fraction_all_channels_mean": sum(fractions_all) / len(fractions_all),
                "lesion_region_target_mse_mean": sum(target_err) / len(target_err),
            }

    per_horizon: dict[str, Any] = {}
    for h in horizons:
        snap = snapshots[h]
        neutral, food, kill = snap[:s_count], snap[s_count:2 * s_count], snap[2 * s_count:]
        errs = visible_error(neutral, target[:s_count])
        coverage = (neutral[..., ALIVE] >= 0.5).float().mean(dim=1)
        food_resp = (food[..., THICKNESS] - neutral[..., THICKNESS]).mean(dim=1)
        kill_resp = (kill[..., THICKNESS] - neutral[..., THICKNESS]).mean(dim=1)
        lo = h // 2
        window_max = max(max(max_abs_per_tick[lo:h]), lesion_max[h])
        progress = 1.0 - errs / seed_err
        per_horizon[str(h)] = {
            "alive_coverage_mean": float(coverage.mean()),
            "alive_coverage_min": float(coverage.min()),
            "visible_mse_mean": float(errs.mean()),
            "growth_progress_mean": float(progress.mean()),
            "growth_progress_min": float(progress.min()),
            "food_thickness_response_mean": float(food_resp.mean()),
            "kill_thickness_response_mean": float(kill_resp.mean()),
            "food_visible_mse_mean": float(visible_error(food, target[s_count:2 * s_count]).mean()),
            "kill_visible_mse_mean": float(visible_error(kill, target[2 * s_count:]).mean()),
            **recovery[h],
            "max_abs_window": window_max,
            "window": [lo, h],
        }

    def w(lo: int, hi: int) -> float:
        return max(max_abs_per_tick[lo:hi])

    trend_ratio = w(2048, 4096) / max(w(512, 1024), 1e-9) if horizons[-1] >= 4096 else float("nan")
    checks = {
        "grows": all(v["alive_coverage_mean"] >= CRITERIA["alive_coverage_min"]
                     and v["growth_progress_mean"] >= CRITERIA["growth_progress_min"] for v in per_horizon.values()),
        "opposite_field_response": all(v["food_thickness_response_mean"] >= CRITERIA["field_response_min"]
                                       and v["kill_thickness_response_mean"] <= -CRITERIA["field_response_min"]
                                       for v in per_horizon.values()),
        "recovers_75": all(v["recovery_fraction_mean"] >= CRITERIA["recovery_fraction_min"] for v in per_horizon.values()),
        "finite": finite,
        "bounded_no_upward_trend": finite and trend_ratio <= CRITERIA["max_abs_trend_ratio_max"],
    }
    return {
        "protocol": "m1-exit-v1",
        "criteria": CRITERIA,
        "held_out": {"fire_seeds": seeds, "fire_stream": EVAL_STREAM, "lesion_centers": centers,
                     "lesion_fraction": fraction, "field_amplitude": amplitude},
        "seed_visible_mse": seed_err,
        "per_horizon": per_horizon,
        "max_abs_trend_ratio_2048_4096_over_512_1024": trend_ratio,
        "max_abs_by_window": {f"{lo}-{hi}": w(lo, hi) for lo, hi in [(0, 512), (512, 1024), (1024, 2048), (2048, 4096)]
                              if hi <= horizons[-1]},
        "checks": checks,
        "pass": all(checks.values()),
    }


def diagnose_m1(model: GraphNCA, graph: Graph, config: dict[str, Any], device: torch.device) -> dict[str, Any]:
    """Non-gating diagnostics added after the exit test was run (never used for the verdict).

    Probes what the gating protocol does not: repair speed, every held-out lesion
    centre, a 50% lesion, fields switched on and off on a mature organism, a local
    field, and whether the mature organism is static or still moving.
    """
    ev = config["evaluation"]
    seeds = [int(s) for s in ev["held_out_seeds"]]
    amplitude = float(ev["field_amplitude"])
    n, c = graph.nodes, model.channels
    dgraph = graph.to(device)
    model = model.to(device).eval()
    neutral = lambda b: neutral_sensors(b, n, model.sensor_channels).to(device)  # noqa: E731
    mature_tick = 512
    out: dict[str, Any] = {"mature_tick": mature_tick}

    with torch.no_grad():
        mature = rollout(model, seed_state(len(seeds), n, c).to(device), neutral(len(seeds)), dgraph, seeds, 0,
                         mature_tick, EVAL_STREAM)
        # Repair speed over all held-out centres, 25% and 50% lesions.
        centers = lesion_centers(graph, held_out=True)
        for fraction in (0.25, 0.5):
            masks = torch.stack([lesion_region(graph, ctr, fraction) for ctr in centers] * len(seeds)).to(device)
            branch_seeds = [s for s in seeds for _ in centers]
            intact = mature.repeat_interleave(len(centers), dim=0)
            state = intact.clone()
            state[masks] = 0.0
            curve = {}
            tick = mature_tick
            ref = intact
            for checkpoint in (16, 32, 64, 128, 256):
                steps = mature_tick + checkpoint - tick
                state = rollout(model, state, neutral(len(branch_seeds)), dgraph, branch_seeds, tick, steps, EVAL_STREAM)
                ref = rollout(model, ref, neutral(len(branch_seeds)), dgraph, branch_seeds, tick, steps, EVAL_STREAM)
                tick = mature_tick + checkpoint
                per = []
                for i in range(len(branch_seeds)):
                    m = masks[i]
                    a0 = intact[i, m, :VISIBLE_CHANNELS].abs().mean()  # lesion zeroes the region
                    a1 = (state[i, m, :VISIBLE_CHANNELS] - ref[i, m, :VISIBLE_CHANNELS]).abs().mean()
                    per.append(float(1.0 - a1 / a0.clamp_min(1e-6)))
                curve[str(checkpoint)] = {"mean": sum(per) / len(per), "min": min(per)}
            out[f"repair_curve_lesion_{int(fraction * 100)}pct_all_{len(centers)}_heldout_centres"] = curve

        # Fields switched on at maturity, then off again.
        target_n = target_visible(graph, neutral_sensors(1, n, model.sensor_channels))[0].to(device)
        field = {}
        for name, channel, value in (("food", SENSOR_F, amplitude), ("kill", SENSOR_K, -amplitude)):
            sensors = neutral(len(seeds))
            sensors[..., channel] = value
            target_f = target_visible(graph, sensors.cpu()).to(device)
            on = rollout(model, mature, sensors, dgraph, seeds, mature_tick, 128, EVAL_STREAM)
            off = rollout(model, on, neutral(len(seeds)), dgraph, seeds, mature_tick + 128, 128, EVAL_STREAM)
            field[name] = {
                "thickness_response_after_128_ticks_on": float((on[..., THICKNESS] - mature[..., THICKNESS]).mean()),
                "visible_mse_vs_field_target_on": float(visible_error(on, target_f).mean()),
                "visible_mse_vs_neutral_target_128_ticks_after_off": float(
                    visible_error(off, target_n[None].expand(len(seeds), -1, -1)).mean()),
            }
        # Local food field on 25% of nodes: response inside vs outside the patch.
        patch = lesion_region(graph, 35, 0.25).to(device)
        sensors = neutral(len(seeds))
        sensors[:, patch, SENSOR_F] = amplitude
        on = rollout(model, mature, sensors, dgraph, seeds, mature_tick, 128, EVAL_STREAM)
        delta = on[..., THICKNESS] - mature[..., THICKNESS]
        field["local_food_patch_25pct"] = {"inside_mean": float(delta[:, patch].mean()),
                                           "outside_mean": float(delta[:, ~patch].mean())}
        out["fields_on_mature_organism"] = field

        # Is the mature organism static? Mean |state change| per tick around tick 4096.
        late = rollout(model, mature, neutral(len(seeds)), dgraph, seeds, mature_tick, 4096 - mature_tick, EVAL_STREAM)
        nxt = rollout(model, late, neutral(len(seeds)), dgraph, seeds, 4096, 1, EVAL_STREAM)
        out["mean_abs_state_change_per_tick_at_4096"] = float((nxt - late).abs().mean())
        out["max_abs_state_change_per_tick_at_4096"] = float((nxt - late).abs().max())
    return out
