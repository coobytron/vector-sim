"""M1 graph NCA: growing-NCA recipe on the per-organism Branching graph.

Everything here is written so the browser CPU reference (M2) can reproduce it
exactly with plain loops and JSON weights:

* the topology is a port of ``src/organisms/morphology.ts::createBranchingMorphology``
  (parent array only; perception uses tree edges);
* the stochastic fire mask is a port of ``src/simulation/prng.ts::counterRandom``
  so a TypeScript runtime draws the same per-node update decisions;
* perception, alive masking, and the residual update are fixed, parameter-free
  operators around one two-layer MLP.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import cos, floor, sin
from typing import Sequence

import numpy as np
import torch
from torch import nn

NO_PARENT = -1

# Channel layout of the per-node state.
ALIVE = 0
THICKNESS = 1
TIP = 2
VISIBLE_CHANNELS = 3

# Sensor layout (matches the six reserved sensor channels in training/README.md).
SENSOR_F = 0  # positive food field, >= 0
SENSOR_K = 1  # negative kill field, <= 0 (stored signed, as in the P05 fixtures)
SENSOR_GRADIENT = 2
SENSOR_HABITAT = 3
SENSOR_GATE = 4
SENSOR_CUSTOM = 5
NEUTRAL_SENSORS = (0.0, 0.0, 0.0, 1.0, 1.0, 0.0)

THICKNESS_ROOT = 0.6
THICKNESS_TIP = 0.2
FIELD_GAIN = 0.5


# ---------------------------------------------------------------------------
# Portable counter-based randomness (port of src/simulation/prng.ts)
# ---------------------------------------------------------------------------

_M32 = np.uint64(0xFFFFFFFF)


def _imul(a: np.ndarray, b: int) -> np.ndarray:
    return (a.astype(np.uint64) * np.uint64(b & 0xFFFFFFFF)) & _M32


def mix32(value: np.ndarray) -> np.ndarray:
    mixed = np.asarray(value, dtype=np.uint64) & _M32
    mixed ^= mixed >> np.uint64(16)
    mixed = _imul(mixed, 0x7FEB352D)
    mixed ^= mixed >> np.uint64(15)
    mixed = _imul(mixed, 0x846CA68B)
    mixed ^= mixed >> np.uint64(16)
    return mixed


def counter_random(seed, organism_id, cell_id, tick, stream=0) -> np.ndarray:
    """Vectorised ``counterRandom(seed, organismId, cellId, tick, stream)`` in [0, 1)."""
    seed, organism_id, cell_id, tick, stream = np.broadcast_arrays(
        *(np.asarray(v, dtype=np.int64) for v in (seed, organism_id, cell_id, tick, stream))
    )
    counter = seed.astype(np.uint64) & _M32
    counter = mix32(counter ^ _imul(organism_id + 1, 0x9E3779B1))
    counter = mix32(counter ^ _imul(cell_id + 1, 0x85EBCA77))
    counter = mix32(counter ^ _imul(tick + 1, 0xC2B2AE3D))
    counter = mix32(counter ^ _imul(stream + 1, 0x27D4EB2F))
    return counter.astype(np.float64) / 4294967296.0


def fire_mask(seeds: Sequence[int], tick: int, nodes: int, rate: float, stream: int) -> torch.Tensor:
    """(B, N) float mask: node fires when counterRandom(seed, 0, node, tick, stream) < rate."""
    seeds_arr = np.asarray(seeds, dtype=np.int64)[:, None]
    cells = np.arange(nodes, dtype=np.int64)[None, :]
    draws = counter_random(seeds_arr, 0, cells, tick, stream)
    return torch.from_numpy((draws < rate).astype(np.float32))


# ---------------------------------------------------------------------------
# Topology (port of createBranchingMorphology)
# ---------------------------------------------------------------------------

def _js_round(value: float) -> int:
    return int(floor(value + 0.5))


def _triangle_wave(value: float) -> float:
    wrapped = value - floor(value)
    return 1.0 - abs(wrapped * 4.0 - 2.0)


def branching_parents(slots: int) -> tuple[list[int], list[tuple[float, float, float]]]:
    """Parent index and local rest position per node, as the TS morphology builds them."""
    parents: list[int] = []
    positions: list[tuple[float, float, float]] = []
    trunk = min(slots, max(8, min(18, _js_round(slots * 0.14))))
    for local in range(trunk):
        positions.append((
            _triangle_wave(local * 0.29 + 0.18) * 0.055 + sin(local * 1.73) * 0.014,
            0.18 + local * 0.052,
            _triangle_wave(local * 0.21 + 0.61) * 0.052 + cos(local * 1.17) * 0.012,
        ))
        parents.append(NO_PARENT if local == 0 else local - 1)

    ranges: list[tuple[int, int, int]] = []
    primary = min(6, max(3, (slots - trunk) // 12))
    branch = 0
    while len(parents) < slots:
        if branch < primary or not ranges:
            parent = min(trunk - 1, 2 + (branch * 3) % max(1, trunk - 3))
        else:
            start_, count_, _ = ranges[(branch - primary) % len(ranges)]
            parent = start_ + min(count_ - 1, 3 + (branch % 4))
        x, y, z = positions[parent]
        start = len(parents)
        count = min(8 + (branch % 4), slots - start)
        azimuth = branch * 2.399963229728653 + (branch % 2) * 0.27
        for along in range(count):
            kink = (along // 2) * (0.19 if branch % 2 == 0 else -0.23)
            direction = azimuth + kink + _triangle_wave(along * 0.37 + branch * 0.13) * 0.16
            step = 0.052 + ((along + branch) % 3) * 0.006
            x += cos(direction) * step
            z += sin(direction) * step
            y += 0.021 + (((along + branch) % 4) - 1.5) * 0.006
            local = len(parents)
            parents.append(parent if along == 0 else local - 1)
            positions.append((x, y, z))
        ranges.append((start, count, parent))
        branch += 1
    return parents, positions


@dataclass
class Graph:
    """Dense operators for a small tree (N <= a few hundred)."""

    parents: list[int]
    positions: list[tuple[float, float, float]]
    depth: torch.Tensor  # (N,) hops from root
    is_tip: torch.Tensor  # (N,) bool, node has no children
    parent_index: torch.Tensor  # (N,) long; root points at itself
    has_parent: torch.Tensor  # (N,) float
    has_children: torch.Tensor  # (N,) float
    neighbor_mean: torch.Tensor  # (N, N) row-normalised adjacency (tree edges)
    child_mean: torch.Tensor  # (N, N) row-normalised child adjacency (zero rows for tips)
    closed_neighbors: torch.Tensor  # (N, D+1) long, self + neighbours padded with self
    adjacency: list[list[int]]

    @property
    def nodes(self) -> int:
        return len(self.parents)

    def to(self, device: torch.device | str) -> "Graph":
        tensors = {
            name: getattr(self, name).to(device)
            for name in ("depth", "is_tip", "parent_index", "has_parent", "has_children",
                         "neighbor_mean", "child_mean", "closed_neighbors")
        }
        return Graph(parents=self.parents, positions=self.positions, adjacency=self.adjacency, **tensors)


def build_graph(parents: Sequence[int], positions: Sequence[tuple[float, float, float]] | None = None) -> Graph:
    n = len(parents)
    adjacency: list[list[int]] = [[] for _ in range(n)]
    children: list[list[int]] = [[] for _ in range(n)]
    for node, parent in enumerate(parents):
        if parent != NO_PARENT:
            adjacency[node].append(parent)
            adjacency[parent].append(node)
            children[parent].append(node)
    depth = [0] * n
    for node, parent in enumerate(parents):
        if parent != NO_PARENT:
            if parent >= node:
                raise ValueError("parents must precede children")
            depth[node] = depth[parent] + 1

    neighbor_mean = torch.zeros((n, n))
    child_mean = torch.zeros((n, n))
    for node in range(n):
        for other in adjacency[node]:
            neighbor_mean[node, other] = 1.0 / len(adjacency[node])
        for child in children[node]:
            child_mean[node, child] = 1.0 / len(children[node])
    width = 1 + max(len(a) for a in adjacency)
    closed = torch.tensor([[node, *adjacency[node]] + [node] * (width - 1 - len(adjacency[node])) for node in range(n)])
    return Graph(
        parents=list(parents),
        positions=list(positions) if positions is not None else [(0.0, 0.0, 0.0)] * n,
        depth=torch.tensor(depth, dtype=torch.float32),
        is_tip=torch.tensor([not c for c in children]),
        parent_index=torch.tensor([p if p != NO_PARENT else i for i, p in enumerate(parents)]),
        has_parent=torch.tensor([0.0 if p == NO_PARENT else 1.0 for p in parents]),
        has_children=torch.tensor([1.0 if c else 0.0 for c in children]),
        neighbor_mean=neighbor_mean,
        child_mean=child_mean,
        closed_neighbors=closed,
        adjacency=adjacency,
    )


def branching_graph(slots: int) -> Graph:
    parents, positions = branching_parents(slots)
    return build_graph(parents, positions)


def lesion_region(graph: Graph, center: int, fraction: float) -> torch.Tensor:
    """Contiguous lesion: the ``round(fraction * N)`` nodes nearest ``center`` by BFS.

    Ties are broken by BFS order with neighbours visited in ascending index, so the
    region is a deterministic function of (graph, center, fraction).
    """
    n = graph.nodes
    count = max(1, _js_round(n * fraction))
    seen = [center]
    visited = {center}
    head = 0
    while head < len(seen) and len(seen) < count:
        for other in sorted(graph.adjacency[seen[head]]):
            if other not in visited:
                visited.add(other)
                seen.append(other)
        head += 1
    mask = torch.zeros(n, dtype=torch.bool)
    mask[seen[:count]] = True
    return mask


def lesion_centers(graph: Graph, held_out: bool) -> list[int]:
    """Training centres: node % 4 != 3. Held-out evaluation centres: node % 4 == 3."""
    return [node for node in range(graph.nodes) if (node % 4 == 3) == held_out]


# ---------------------------------------------------------------------------
# Targets and sensors
# ---------------------------------------------------------------------------

def neutral_sensors(batch: int, nodes: int, sensor_channels: int = 6) -> torch.Tensor:
    sensors = torch.zeros((batch, nodes, sensor_channels))
    for channel, value in enumerate(NEUTRAL_SENSORS[:sensor_channels]):
        sensors[..., channel] = value
    return sensors


def target_visible(graph: Graph, sensors: torch.Tensor) -> torch.Tensor:
    """(B, N, 3) target for [alive, thickness, tip].

    Thickness tapers from root to deepest node and is modulated locally by the
    fields: ``base * (1 + FIELD_GAIN * (F + K))`` with F >= 0 and K <= 0 stored
    in separate channels, so food thickens and kill thins the organism.
    """
    depth = graph.depth
    base = THICKNESS_ROOT - (THICKNESS_ROOT - THICKNESS_TIP) * depth / depth.max().clamp_min(1.0)
    modulation = 1.0 + FIELD_GAIN * (sensors[..., SENSOR_F] + sensors[..., SENSOR_K])
    thickness = base[None, :] * modulation
    alive = torch.ones_like(thickness)
    tip = graph.is_tip.to(thickness.dtype)[None, :].expand_as(thickness)
    return torch.stack([alive, thickness, tip], dim=-1)


def seed_state(batch: int, nodes: int, channels: int, root: int = 0) -> torch.Tensor:
    """Growing-NCA seed: one live node with alive and hidden channels at 1."""
    state = torch.zeros((batch, nodes, channels))
    state[:, root, ALIVE] = 1.0
    state[:, root, VISIBLE_CHANNELS:] = 1.0
    return state


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class GraphNCA(nn.Module):
    """``state += fire_mask * W2 · relu(W1 · perceive(state, sensors) + b1)``.

    perceive = [self, mean(neighbours) - self, parent - self, mean(children) - self, sensors]
    (each state block is ``channels`` wide; parent/children terms are zero at the root/tips).
    """

    architecture = "vector_graph_nca_v1"

    def __init__(self, channels: int, sensor_channels: int, hidden_width: int,
                 fire_rate: float = 0.5, alive_threshold: float = 0.1):
        super().__init__()
        self.channels = channels
        self.sensor_channels = sensor_channels
        self.hidden_width = hidden_width
        self.fire_rate = fire_rate
        self.alive_threshold = alive_threshold
        self.w1 = nn.Linear(channels * 4 + sensor_channels, hidden_width)
        self.w2 = nn.Linear(hidden_width, channels, bias=False)
        nn.init.zeros_(self.w2.weight)

    @staticmethod
    def perceive(state: torch.Tensor, sensors: torch.Tensor, graph: Graph) -> torch.Tensor:
        lap = torch.matmul(graph.neighbor_mean, state) - state
        up = (state[:, graph.parent_index] - state) * graph.has_parent[None, :, None]
        down = (torch.matmul(graph.child_mean, state) - state) * graph.has_children[None, :, None]
        return torch.cat([state, lap, up, down, sensors], dim=-1)

    def alive(self, state: torch.Tensor, graph: Graph) -> torch.Tensor:
        pooled = state[..., ALIVE][:, graph.closed_neighbors].amax(dim=-1)
        return pooled > self.alive_threshold

    def step(self, state: torch.Tensor, sensors: torch.Tensor, graph: Graph, mask: torch.Tensor) -> torch.Tensor:
        pre = self.alive(state, graph)
        delta = self.w2(torch.relu(self.w1(self.perceive(state, sensors, graph))))
        state = state + delta * mask[..., None]
        life = pre & self.alive(state, graph)
        return state * life[..., None].to(state.dtype)


def rollout(model: GraphNCA, state: torch.Tensor, sensors: torch.Tensor, graph: Graph,
            seeds: Sequence[int], start_tick: int, steps: int, stream: int) -> torch.Tensor:
    for tick in range(start_tick, start_tick + steps):
        mask = fire_mask(seeds, tick, graph.nodes, model.fire_rate, stream).to(state.device)
        state = model.step(state, sensors, graph, mask)
    return state


def overflow_loss(state: torch.Tensor) -> torch.Tensor:
    """Mean amount by which |state| exceeds 1; zero inside [-1, 1]."""
    return (state - state.clamp(-1.0, 1.0)).abs().mean()


def visible_error(state: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Per-sample MSE on the visible channels, shape (B,)."""
    return (state[..., :VISIBLE_CHANNELS] - target).pow(2).mean(dim=(1, 2))
