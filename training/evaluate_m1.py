"""M1 exit test on held-out seeds and lesion positions, untrained baseline vs checkpoint.

    PYTHONPATH=training python training/evaluate_m1.py \
        --config training/configs/m1-pool.yaml \
        --checkpoint training/artifacts/m1-pool/branching-m1.pt \
        --out training/evidence/m1-pool/evaluation.json --device cpu
"""
from __future__ import annotations

import argparse
import json
import time
from hashlib import sha256
from pathlib import Path

import torch

from vector_nca.core import load_config
from vector_nca.m1 import environment_receipt, graph_from_config, load_m1, model_from_config, resolve_device, set_determinism
from vector_nca.m1_eval import diagnose_m1, evaluate_m1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="training/configs/m1-pool.yaml")
    parser.add_argument("--checkpoint", default=None, help="trained .pt; omit to evaluate the baseline only")
    parser.add_argument("--out", required=True)
    parser.add_argument("--diagnostics", action="store_true", help="also run non-gating diagnostics")
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="cpu")
    args = parser.parse_args()

    config = load_config(args.config)
    device = resolve_device(args.device)
    graph = graph_from_config(config)
    report: dict = {"config": args.config, "environment": environment_receipt(device)}

    # Untrained baseline: same architecture and init seed as training (zero final layer => no-op).
    set_determinism(int(config["seed"]), device)
    started = time.perf_counter()
    report["baseline"] = evaluate_m1(model_from_config(config), graph, config, device)
    if args.checkpoint:
        checkpoint = Path(args.checkpoint)
        report["checkpoint"] = {"path": checkpoint.name, "sha256": sha256(checkpoint.read_bytes()).hexdigest()}
        manifest = checkpoint.with_suffix(".manifest.json")
        if manifest.exists():
            m = json.loads(manifest.read_text())
            report["checkpoint"].update({k: m.get(k) for k in ("checkpoint_version", "training_device",
                                                               "training_wall_seconds", "environment")})
        report["trained"] = evaluate_m1(load_m1(checkpoint, config, device), graph, config, device)
        report["verdict"] = "PASS" if report["trained"]["pass"] else "FAIL"
        if args.diagnostics:
            report["trained_diagnostics_non_gating"] = diagnose_m1(load_m1(checkpoint, config, device), graph, config, device)
    report["evaluation_wall_seconds"] = round(time.perf_counter() - started, 1)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    summary = {k: report[k]["checks"] for k in ("baseline", "trained") if k in report}
    print(json.dumps({"verdict": report.get("verdict"), "checks": summary}, indent=2))


if __name__ == "__main__":
    main()
