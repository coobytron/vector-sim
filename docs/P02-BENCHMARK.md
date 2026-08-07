# P02 runtime benchmark and budgets

This document separates three evidence classes so a fast development host is
never mistaken for proof that a phone passes.

1. **Node reference:** learned-update math plus the same vector-buffer packing
   used by the renderer; no GPU rasterization.
2. **Browser paired run:** 30 Hz simulation, buffer packing, Three.js draw, and
   requestAnimationFrame intervals on the actual device.
3. **GPU probes:** WebGL2 ping-pong and transform-feedback throughput proxies;
   useful for architecture comparison but not semantically equivalent to the
   sparse graph runtime.

## Reference devices

| Tier | Named baseline | Required run |
|---|---|---|
| Desktop | MacBook Pro, Apple M1 Max, 32 GB; Safari 26.x; 1920×1080 viewport; DPR capped at 1.5 | 8 organisms × 256 slots, 60 fps target |
| Mobile | iPhone 16 Pro; iOS 26.5.2 Mobile Safari; long edge capped at 1280 px; DPR capped at 1.25 | 4 organisms × 128 slots, 30 fps target and five-minute thermal run |

Every downloaded browser result includes exact user agent, platform, viewport,
DPR, core/memory hints when exposed, renderer counts, state hash, and timestamp.

## Committed Node reference result

Source: `benchmark-results/node-reference-2026-08-07.json`. Host: Node 24.14,
Linux 6.18, AMD EPYC 9V74. Each tier warms for 30 ticks, then records 180 paired
samples.

| Tier | Nodes | Edges | Median | P95 | P99 | Worst | Estimated state |
|---|---:|---:|---:|---:|---:|---:|---:|
| Mobile | 512 | 536 | 0.525 ms | 0.651 ms | 1.004 ms | 1.113 ms | 187,072 B |
| Desktop | 2,048 | 2,160 | 2.140 ms | 2.547 ms | 3.864 ms | 4.455 ms | 748,416 B |

These results justify keeping the CPU reference executable and headless. They do
not close the physical Safari performance gate.

## Candidate comparison

| Candidate | Evidence in P02 | Sparse dynamic graph fit | Decision |
|---|---|---|---|
| Typed-array CPU reference | Committed paired tick/pack percentiles and deterministic tests | Direct stable-slot and adjacency representation | Authoritative state truth and small-device fallback |
| CPU/WASM | Shares a future ABI with the reference path; no separate binary yet | Direct; lower overhead is possible after profile evidence | Add only if on-device JS misses the CPU budget |
| WebGL2 ping-pong textures | Browser measures six RGBA32F passes per cell as a 24-channel proxy | Strong for dense grids; graph scatter and topology resolution are awkward | Throughput probe only, not MVP truth |
| WebGL2 transform feedback | Browser measures six `vec4` records per cell | Better sparse throughput, but adjacency gathering and deterministic births remain awkward | Throughput probe only |
| WebGPU compute | Capability is reported and the boundary remains adapter-ready | Best future fit for explicit storage buffers and graph kernels | Progressive path after trained weights exist; never an undocumented requirement |
| Three.js WebGL2 vector renderer | Full paired browser run uses instanced nodes, line edges, and indexed ribbons | Rendering consumes stable snapshot IDs | Selected MVP presentation path |

The WebGL probes call `gl.finish()` for each timed sample. Their results measure
completed GPU work rather than submission time, but they remain synthetic
throughput proxies and cannot replace the full paired frame result.

## P02 budgets

| Budget | Desktop | Mobile | Failure action |
|---|---:|---:|---|
| Simulation tick CPU P95 | ≤4 ms at 8×256 | ≤8 ms at 4×128 | Profile; move the same kernel ABI to WASM before reducing semantics |
| Frame interval median | ≤16.7 ms | ≤33.3 ms | Lower render resolution/tessellation only |
| Frame interval P95 | ≤20 ms | ≤40 ms | Reduce shadow/antialias cost; preserve state tier |
| Frame interval P99 | ≤30 ms | ≤55 ms | Record hitch source and block Home approval if repeated |
| Reference-state memory | ≤64 MB | ≤32 MB | Fail allocation with a readable fallback |
| Initial JS + CSS gzip, before model weights | ≤200 KB | ≤200 KB | Split optional tools and defer noncritical imports |
| First usable canvas, warm HTTP cache | ≤2.5 s | ≤4 s | Record startup phases and asset bytes |
| Renderer draw calls for P02 fixture | ≤12 | ≤12 | Preserve instancing/batching |

The P02 production build measured 147.2 KB gzip JavaScript, 1.23 KB gzip CSS,
and 0.36 KB gzip HTML before trained weights. The uncompressed Vite warning is
tracked, but the transfer budget passes.

## Running the evidence

```bash
npm run benchmark:node
npm run dev
```

Then open one of:

- `http://127.0.0.1:5173/?benchmark=1&quality=desktop`
- `http://127.0.0.1:5173/?benchmark=1&quality=mobile`
- `http://127.0.0.1:5173/?benchmark=1&quality=mobile&duration=300` for the thermal gate

The browser route warms for two seconds, samples the paired visible workload for
eight seconds by default (or 300 seconds for the thermal route), runs both WebGL2
probes, records automatic tier changes, and exposes a **Download JSON** action.
The downloaded physical Mac and iPhone results are the remaining evidence needed
to mark the corresponding issue checks complete.
