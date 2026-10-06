"""M1: train the Branching graph NCA with the growing-NCA sample-pool recipe.

    PYTHONPATH=training python training/run_pool.py \
        --config training/configs/m1-pool.yaml --out training/artifacts/m1-pool --device cpu
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch

from vector_nca.core import load_config
from vector_nca.m1 import graph_from_config, resolve_device, save_m1, train


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="training/configs/m1-pool.yaml")
    parser.add_argument("--out", default="training/artifacts/m1-pool")
    parser.add_argument("--name", default="branching-m1")
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="cpu")
    parser.add_argument("--threads", type=int, default=0, help="torch CPU threads (0 = torch default)")
    parser.add_argument("--iterations", type=int, default=0, help="override training.iterations")
    args = parser.parse_args()

    if args.threads:
        torch.set_num_threads(args.threads)
    config = load_config(args.config)
    if args.iterations:
        config["training"]["iterations"] = args.iterations
    device = resolve_device(args.device)
    print(json.dumps({"device": str(device), "torch": torch.__version__}), flush=True)

    started = time.perf_counter()
    model, _pool, history = train(config, device, log=lambda r: print(json.dumps(r), flush=True))
    wall = time.perf_counter() - started
    manifest = save_m1(Path(args.out), args.name, model, graph_from_config(config), config, device, history, wall)
    print(json.dumps({"checkpoint": str(Path(args.out) / f"{args.name}.pt"), "sha256": manifest["sha256"],
                      "wall_seconds": round(wall, 1)}), flush=True)


if __name__ == "__main__":
    sys.exit(main())
