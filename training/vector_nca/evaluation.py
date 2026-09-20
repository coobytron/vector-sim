from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from typing import Any

import torch

from .core import PhenotypeTarget, VectorNCA, phenotype_loss


def controlled_sensor_scenarios(
    sensors: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    if sensors.ndim != 2 or sensors.shape[1] < 2:
        raise ValueError("controlled evaluation requires at least two sensor channels")

    neutral = sensors.clone()
    neutral[:, 0] = 0.0
    neutral[:, 1] = 0.0

    positive = neutral.clone()
    positive[:, 0] = sensors[:, 0]

    negative = neutral.clone()
    negative[:, 1] = sensors[:, 1]

    return neutral, positive, negative


def _nan_rate(states: list[torch.Tensor]) -> float:
    total = sum(state.numel() for state in states)
    invalid = sum((~torch.isfinite(state)).sum().item() for state in states)
    return float(invalid / max(1, total))


def _max_abs(states: list[torch.Tensor]) -> float:
    return float(max(state.abs().max().item() for state in states))


def evaluate_candidate(
    model: VectorNCA,
    initial: torch.Tensor,
    sensors: torch.Tensor,
    lesion_mask: torch.Tensor,
    positions: torch.Tensor,
    target: PhenotypeTarget,
    horizon: int,
) -> dict[str, float]:
    if horizon < 4:
        raise ValueError("controlled evaluation horizon must be >= 4")

    neutral_sensors, positive_sensors, negative_sensors = controlled_sensor_scenarios(sensors)
    pre_steps = max(1, horizon // 4)
    recovery_steps = horizon - pre_steps

    with torch.no_grad():
        neutral = model.rollout(initial, neutral_sensors, horizon)
        positive = model.rollout(initial, positive_sensors, horizon)
        negative = model.rollout(initial, negative_sensors, horizon)

        pre_lesion = model.rollout(initial, neutral_sensors, pre_steps)
        intact = model.rollout(pre_lesion, neutral_sensors, recovery_steps)
        lesioned = pre_lesion.clone()
        lesioned[lesion_mask] = 0.0
        recovered = model.rollout(lesioned, neutral_sensors, recovery_steps)

    immediate_damage = (pre_lesion[lesion_mask] - lesioned[lesion_mask]).abs().mean()
    recovery_error = (recovered[lesion_mask] - intact[lesion_mask]).abs().mean()
    recovery_delta = immediate_damage - recovery_error
    recovery_fraction = recovery_delta / immediate_damage.clamp_min(1e-6)

    positive_response = (positive - neutral).abs().mean()
    negative_response = (negative - neutral).abs().mean()
    field_contrast = (positive - negative).abs().mean()

    states = [neutral, positive, negative, intact, recovered]
    return {
        "growth": float((neutral.abs().mean() - initial.abs().mean()).item()),
        "stability_error": float((neutral - initial).pow(2).mean().item()),
        "positive_field_response": float(positive_response.item()),
        "negative_field_response": float(negative_response.item()),
        "field_contrast": float(field_contrast.item()),
        "damage_recovery_delta": float(recovery_delta.item()),
        "damage_recovery_fraction": float(recovery_fraction.item()),
        "damage_recovery_error": float(recovery_error.item()),
        "max_abs_state": _max_abs(states),
        "nan_rate": _nan_rate(states),
        "phenotype_target_loss": float(phenotype_loss(neutral, positions, target).item()),
    }


def preview_sequence(
    model: VectorNCA,
    initial: torch.Tensor,
    sensors: torch.Tensor,
    horizon: int,
) -> list[dict[str, Any]]:
    neutral, _positive, _negative = controlled_sensor_scenarios(sensors)
    ticks = sorted({0, 1, min(4, horizon), min(16, horizon), min(64, horizon), horizon})
    state = initial.clone()
    previous_tick = 0
    frames: list[dict[str, Any]] = []

    with torch.no_grad():
        for tick in ticks:
            if tick > previous_tick:
                state = model.rollout(state, neutral, tick - previous_tick)
            raw = state.detach().cpu().to(torch.float32).contiguous().numpy().tobytes()
            profile = torch.tanh(state[:, :3].norm(dim=1) / 8.0)
            frames.append(
                {
                    "tick": tick,
                    "sha256": sha256(raw).hexdigest(),
                    "mean_abs": float(state.abs().mean().item()),
                    "max_abs": float(state.abs().max().item()),
                    "channel_means": [
                        float(state[:, channel].mean().item())
                        for channel in range(min(3, state.shape[1]))
                    ],
                    "profile": [float(value) for value in profile.tolist()],
                }
            )
            previous_tick = tick

    return frames


def write_preview_svg(path: str | Path, frames: list[dict[str, Any]]) -> None:
    path = Path(path)
    panel_width = 160
    panel_height = 120
    margin = 12
    width = panel_width * len(frames)
    height = panel_height

    groups: list[str] = []
    for panel, frame in enumerate(frames):
        values = frame["profile"]
        inner_width = panel_width - margin * 2
        inner_height = panel_height - margin * 2
        denominator = max(1, len(values) - 1)
        points = []
        for index, value in enumerate(values):
            x = panel * panel_width + margin + inner_width * index / denominator
            y = margin + inner_height * (1.0 - max(0.0, min(1.0, float(value))))
            points.append(f"{x:.3f},{y:.3f}")
        groups.append(
            f'<g id="tick-{frame["tick"]}">'
            f'<title>tick {frame["tick"]}</title>'
            f'<rect x="{panel * panel_width}" y="0" width="{panel_width}" height="{panel_height}" '
            'fill="#ffffff" stroke="#d8d8d8" stroke-width="1"/>'
            f'<polyline points="{" ".join(points)}" fill="none" stroke="#555555" stroke-width="1.5"/>'
            "</g>"
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        + "".join(groups)
        + "</svg>\n"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg)
