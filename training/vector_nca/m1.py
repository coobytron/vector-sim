"""M1 pool training loop, checkpointing, and JSON weight export."""
from __future__ import annotations

import json
import platform
import time
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch

from .graph_nca import (
    ALIVE,
    SENSOR_F,
    SENSOR_K,
    THICKNESS,
    TIP,
    VISIBLE_CHANNELS,
    Graph,
    GraphNCA,
    branching_graph,
    fire_mask,
    lesion_centers,
    neutral_sensors,
    overflow_loss,
    rollout,
    seed_state,
    target_visible,
    visible_error,
)
from .pool import SamplePool, prepare_batch, sample_fields, sample_training_lesions

JSON_FORMAT = "vector-sim.graph-nca.v1"
TRAIN_STREAM = 0
EVAL_STREAM = 1
GOLDEN_STREAM = 2


def resolve_device(name: str) -> torch.device:
    if name == "auto":
        if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    return torch.device(name)


def set_determinism(seed: int, device: torch.device) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)
    # Deterministic kernels are enforced on CPU (the reference device). MPS/CUDA
    # may differ bitwise and are recorded as such in the manifest.
    torch.use_deterministic_algorithms(device.type == "cpu")


def graph_from_config(config: dict[str, Any]) -> Graph:
    if config.get("phenotype", "branching") != "branching":
        raise ValueError("M1 trains the branching phenotype only")
    return branching_graph(int(config["graph"]["slots"]))


def model_from_config(config: dict[str, Any]) -> GraphNCA:
    m = config["model"]
    return GraphNCA(int(m["channels"]), int(m["sensor_channels"]), int(m["hidden_width"]),
                    float(m["fire_rate"]), float(m["alive_threshold"]))


def environment_receipt(device: torch.device) -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "device": str(device),
        "torch_threads": torch.get_num_threads(),
        "deterministic_reference": device.type == "cpu",
    }


def train(config: dict[str, Any], device: torch.device,
          log: Callable[[dict[str, Any]], None] | None = None) -> tuple[GraphNCA, SamplePool, list[dict[str, Any]]]:
    seed = int(config["seed"])
    set_determinism(seed, device)
    t = config["training"]
    rng = np.random.default_rng(seed)
    graph = graph_from_config(config)
    dgraph = graph.to(device)
    model = model_from_config(config).to(device)
    channels = model.channels
    seed_cpu = seed_state(1, graph.nodes, channels)[0]
    pool = SamplePool(seed_cpu, int(t["pool_size"]))
    optimizer = torch.optim.Adam(model.parameters(), lr=float(t["learning_rate"]))
    scheduler = torch.optim.lr_scheduler.MultiStepLR(
        optimizer, milestones=[int(m) for m in t.get("lr_milestones", [])], gamma=float(t.get("lr_gamma", 0.1)))
    batch_size = int(t["batch_size"])
    damage_count = int(t["damage_count"])
    damage_start = int(t.get("damage_start", 0))
    fraction = float(t["lesion_fraction"])
    centers = lesion_centers(graph, held_out=False)
    rmin, rmax = (int(v) for v in t["rollout_range"])
    fields = t["fields"]
    overflow_weight = float(t["overflow_weight"])
    history: list[dict[str, Any]] = []
    started = time.perf_counter()

    for iteration in range(int(t["iterations"])):
        indices = pool.sample(batch_size, rng)
        batch = pool.states[torch.as_tensor(indices)]
        sensors = sample_fields(graph, rng, batch_size, model.sensor_channels, fields["probabilities"],
                                tuple(fields["amplitude"]), tuple(fields["local_fraction"]))
        target = target_visible(graph, sensors)
        pre_losses = visible_error(batch, target)
        lesions = sample_training_lesions(graph, rng, damage_count if iteration >= damage_start else 0, fraction, centers)
        batch, _, _ = prepare_batch(batch, pre_losses, seed_cpu, lesions)
        steps = int(rng.integers(rmin, rmax + 1))
        seeds = rng.integers(0, 2**31 - 1, size=batch_size)

        state = batch.to(device)
        dsensors = sensors.to(device)
        overflow = state.new_zeros(())
        for tick in range(steps):
            mask = fire_mask(seeds, tick, graph.nodes, model.fire_rate, TRAIN_STREAM).to(device)
            state = model.step(state, dsensors, dgraph, mask)
            overflow = overflow + overflow_loss(state)
        per_sample = visible_error(state, target.to(device))
        target_loss = per_sample.mean()
        loss = target_loss + overflow_weight * overflow / steps

        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        with torch.no_grad():
            for parameter in model.parameters():
                if parameter.grad is not None:
                    parameter.grad /= parameter.grad.norm() + 1e-8
        optimizer.step()
        scheduler.step()
        pool.write_back(indices, state.cpu())

        record = {
            "iteration": iteration,
            "loss": float(loss.item()),
            "target_loss": float(target_loss.item()),
            "overflow": float((overflow / steps).item()),
            "steps": steps,
            "lr": float(scheduler.get_last_lr()[0]),
            "pool_max_abs": float(state.detach().abs().max().item()),
            "elapsed_s": round(time.perf_counter() - started, 3),
        }
        if iteration % int(t.get("log_every", 50)) == 0 or iteration == int(t["iterations"]) - 1:
            history.append(record)
            if log:
                log(record)
    return model, pool, history


def _tensor_json(tensor: torch.Tensor) -> dict[str, Any]:
    array = tensor.detach().cpu().to(torch.float32).contiguous()
    return {"shape": list(array.shape), "data": [float(v) for v in array.flatten().tolist()]}


def golden_vector(model: GraphNCA, graph: Graph, ticks: tuple[int, ...] = (1, 8, 32), seed: int = 12345) -> dict[str, Any]:
    """Fixed input -> output trace for the browser parity test (CPU, float32)."""
    cpu_model = model.to("cpu")
    state = seed_state(1, graph.nodes, model.channels)
    sensors = neutral_sensors(1, graph.nodes, model.sensor_channels)
    frames = []
    tick = 0
    with torch.no_grad():
        for target_tick in ticks:
            state = rollout(cpu_model, state, sensors, graph, [seed], tick, target_tick - tick, GOLDEN_STREAM)
            tick = target_tick
            raw = state[0].contiguous().numpy().astype("<f4").tobytes()
            frames.append({"tick": tick, "sha256_f32le": sha256(raw).hexdigest(),
                           "state": [round(float(v), 7) for v in state[0].flatten().tolist()]})
    return {"fire_seed": seed, "fire_stream": GOLDEN_STREAM, "sensors": "neutral", "initial": "seed_state(root=0)",
            "frames": frames}


def save_m1(out_dir: Path, name: str, model: GraphNCA, graph: Graph, config: dict[str, Any],
            device: torch.device, history: list[dict[str, Any]], wall_seconds: float) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = out_dir / f"{name}.pt"
    cpu_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
    torch.save(cpu_state, checkpoint)
    checksum = sha256(checkpoint.read_bytes()).hexdigest()
    model_cpu = model_from_config(config)
    model_cpu.load_state_dict(cpu_state)
    manifest = {
        "schema_version": 1,
        "architecture": GraphNCA.architecture,
        "phenotype": "branching",
        "checkpoint_version": str(config.get("checkpoint_version", "m1-pool")),
        "channels": model.channels,
        "sensor_channels": model.sensor_channels,
        "hidden_width": model.hidden_width,
        "fire_rate": model.fire_rate,
        "alive_threshold": model.alive_threshold,
        "graph_slots": graph.nodes,
        "dtype": "float32",
        "sha256": checksum,
        "training_seed": int(config["seed"]),
        "training_device": str(device),
        "environment": environment_receipt(device),
        "training_wall_seconds": round(wall_seconds, 1),
        "final_history": history[-1] if history else None,
        "config": config,
    }
    (out_dir / f"{name}.manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    (out_dir / f"{name}.history.json").write_text(json.dumps(history, indent=1) + "\n")
    export = export_weights_json(model_cpu, graph, manifest)
    (out_dir / f"{name}.weights.json").write_text(json.dumps(export, separators=(",", ":")) + "\n")
    return manifest


def export_weights_json(model: GraphNCA, graph: Graph, manifest: dict[str, Any]) -> dict[str, Any]:
    c = model.channels
    return {
        "format": JSON_FORMAT,
        "architecture": GraphNCA.architecture,
        "phenotype": "branching",
        "channels": c,
        "sensor_channels": model.sensor_channels,
        "hidden_width": model.hidden_width,
        "fire_rate": model.fire_rate,
        "alive_threshold": model.alive_threshold,
        "channel_layout": {"alive": ALIVE, "thickness": THICKNESS, "tip": TIP,
                           "hidden": [VISIBLE_CHANNELS, c - 1]},
        "sensor_layout": ["F_food(>=0)", "K_kill(<=0,signed)", "gradient", "habitat", "gate", "custom"],
        "neutral_sensors": [0.0, 0.0, 0.0, 1.0, 1.0, 0.0],
        "perception": [
            "self",
            "mean(tree_neighbors) - self",
            "state[parent] - self (0 at root)",
            "mean(children) - self (0 at tips)",
            "sensors",
        ],
        "update": ("pre = alive(s); s += mask * (w2 @ relu(w1 @ perceive(s) + b1)); "
                   "s *= pre & alive(s); alive(s)[n] = max(s[m][0] for m in {n} U neighbors(n)) > alive_threshold"),
        "fire_mask": "counterRandom(seed, 0, node, tick, stream) < fire_rate  (src/simulation/prng.ts)",
        "topology": {"family": "branching", "slots": graph.nodes,
                     "source": "src/organisms/morphology.ts::createBranchingMorphology (tree edges only)",
                     "parents": graph.parents},
        "tensors": {
            "w1": _tensor_json(model.w1.weight),
            "b1": _tensor_json(model.w1.bias),
            "w2": _tensor_json(model.w2.weight),
        },
        "tensor_layout": "row-major [out, in]; w1 input order = perception blocks above, each `channels` wide",
        "golden": golden_vector(model, graph),
        "provenance": {"pt_sha256": manifest["sha256"], "training_device": manifest["training_device"],
                       "torch": manifest["environment"]["torch"], "training_seed": manifest["training_seed"],
                       "checkpoint_version": manifest["checkpoint_version"]},
    }


def load_m1(checkpoint: Path, config: dict[str, Any], device: torch.device) -> GraphNCA:
    model = model_from_config(config)
    model.load_state_dict(torch.load(checkpoint, map_location="cpu"))
    return model.to(device)
