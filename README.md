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

**P01 — Governing specification.** No renderer or simulation architecture is
considered locked until this phase is approved.

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

## Phase order

1. Lock the governing contracts and approval measures.
2. Benchmark browser GPU simulation and rendering approaches.
3. Build the spectral color and vector-organism foundations.
4. Train and integrate the graph NCA.
5. Complete the Home vertical slice in all three looks.
6. Adapt the same contracts to Forest, then Pond.

## Validate this phase

Requires Node.js 20 or newer and no package installation:

```bash
npm run validate:p01
```

The validator checks the required specification files, governing terminology,
reference-atlas dimensions, and internal Markdown links. It does not claim that
the later interactive Home gate has passed.
