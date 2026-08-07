# Vector Sim — Spectral Homestead

Spectral Homestead is a browser-based environment simulator where graph-shaped
3D vector organisms grow, adapt, feed, fracture, and regenerate through Neural
Cellular Automata (NCA).

The first vertical slice is a porcelain-white home. Architecture is part of the
simulation: a doorway can feed, a wall can kill, a window can provide habitat,
and a room can become a visible field. Spectral color is never decoration. It
appears only when it explains cause, transfer, damage, mutation, regeneration,
or an explicitly enabled inspection view.

![Spectral Homestead reference atlas](assets/reference/spectral-homestead-reference-atlas.png)

## Current phase

**P02 — Runtime benchmark and static application foundation.** The P01 creative
and simulation contracts are approved. P02 provides a deterministic headless
reference runtime, a WebGL2/Three.js vector renderer, explicit capability
fallbacks, and repeatable desktop/mobile benchmark routes.

The non-negotiable direction is:

- high-key white architectural environments;
- designed 3D vector organisms made from nodes, edges, ribbons, branches, and
  occasional faceted membranes;
- deterministic environment-independent food and kill semantics;
- localized, wavelength-ordered spectral emission that reveals causality;
- Home completed and approved before Forest and Pond are adapted;
- desktop, touch, and opt-in phone motion camera controls.

## Specification index

- [Project brief](docs/PROJECT-BRIEF.md)
- [Art direction](docs/ART-DIRECTION.md)
- [Simulation contract](docs/SIMULATION-CONTRACT.md)
- [Environment contract](docs/ENVIRONMENT-CONTRACT.md)
- [Decision log](docs/DECISIONS.md)
- [Reference atlas](docs/REFERENCE-ATLAS.md)
- [Home approval checklist](docs/HOME-APPROVAL-CHECKLIST.md)
- [Runtime architecture](docs/ARCHITECTURE.md)
- [P02 benchmark and budgets](docs/P02-BENCHMARK.md)
- [P02 runtime decision](docs/adr/0001-runtime-backend.md)

## Phase order

1. Lock the governing contracts and approval measures.
2. Benchmark browser GPU simulation and rendering approaches.
3. Build the spectral color and vector-organism foundations.
4. Train and integrate the graph NCA.
5. Complete the Home vertical slice in all three looks.
6. Adapt the same contracts to Forest, then Pond.

## Start locally

Requires Node.js 20.19 or newer:

```bash
npm install
npm run dev
```

The production output is a static bundle in `dist/`; it has no server runtime.

```bash
npm run qa
npm run benchmark:node
npm run build
```

Open `?benchmark=1&quality=desktop` or `?benchmark=1&quality=mobile` in the
browser build to run the paired learned-update/vector-render benchmark and
download its JSON evidence. The benchmark also records WebGL2 ping-pong and
transform-feedback throughput probes on the current device. Use
`?benchmark=1&quality=mobile&duration=300` for the five-minute thermal gate.
