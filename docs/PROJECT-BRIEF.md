# Project brief

**Project:** Vector Sim — Spectral Homestead  
**Phase:** P01 governing specification  
**Creative owner:** Colson Knight  
**Implementation owner:** Codex  
**Status:** Proposed for approval

## Thesis

Spectral Homestead turns familiar architecture into a legible artificial
ecosystem. Abstract vector organisms do not merely move through a modeled home;
they perceive it, metabolize it, avoid it, become damaged by it, and learn a
repeatable local response through Neural Cellular Automata.

The world begins almost entirely white. Color is earned by an event. When energy
moves from a threshold into an organism, a spectral sequence travels along the
same path. When a lethal wall breaks connectivity, a restrained red event marks
the contact and the affected edges retract. A still frame should explain
where an event occurred; motion should explain how it propagated.

## Intended feeling

The experience should feel like a calm architectural model that has become
quietly alive: precise, uncanny, luminous, and observable. It should reward
watching rather than winning. The tone is closer to a gallery instrument or a
living systems study than a game, screensaver, or creature collector.

## Audience

The primary audience is designers, artists, creative technologists, educators,
and curious non-specialists. The simulation must communicate its basic cause and
effect without requiring them to understand machine learning. Inspection tools
may reveal deeper state, but the default view must remain visually coherent.

## Core experience loop

1. Enter a composed architectural scene.
2. Seed one or more vector organisms into a permitted region.
3. Observe them sense local geometry and fields.
4. Read feeding, avoidance, damage, and regeneration through motion and spectral
   transfer rather than UI alerts.
5. Change the environment, seed, camera, look, or simulation speed.
6. Replay or export a deterministic result.

There is no score, inventory, combat, dialogue, or prescribed win state.

## Home vertical-slice boundary

Home is the first approval gate and the only authored environment required for
the MVP. It is a cutaway domestic volume approximately 12 m × 8 m × 3 m with:

- one spawn region;
- one doorway or threshold that supplies food;
- one wall or architectural fault that supplies kill exposure;
- one shelter region that reduces idle energy loss;
- one habitat region that conditions behavior without directly changing energy;
- neutral obstacles including a stair, table, and room boundary;
- one complete camera path plus desktop, touch, and opt-in Motion Look controls;
- Porcelain Spectrum, Technical Wire, and Ghost Volume looks;
- at least one graph-NCA phenotype able to feed, sustain damage, and regenerate;
- deterministic seed/replay plus PNG and simulation-state export.

The Home scene is not a photoreal interior. It is an abstract architectural
model with enough domestic cues to be immediately recognized.

## Later environment plan

Forest and Pond are adaptations, not separate simulation systems.

### Forest gate

Forest replaces rooms with contour trunks, roots, canopy planes, and terrain. It
must reuse the same field channels, organism model, lifecycle, looks, camera
contract, replay format, and export path. Roots may feed and selected trunks or
faults may kill; habitat can represent canopy or ground preference.

### Pond gate

Pond adds a sculptural basin, inlet, drain, signed flow, and submerged habitat.
It must reuse the same contracts. The inlet may feed, the drain may kill, and
flow may transport without itself changing health or energy.

Neither gate may begin by changing the meaning of a shared channel. A required
new channel must first amend the governing contracts and include a Home
regression test.

## Non-goals for the Home MVP

- photoreal rooms, furniture, or physically exact construction;
- conventional animal bodies, faces, personalities, or game AI;
- a general-purpose physics sandbox;
- online model training in the browser;
- a world-scale shared voxel NCA;
- multiplayer, accounts, cloud saves, or social features;
- arbitrary user-imported 3D scenes;
- Forest or Pond content before Home approval;
- positional phone tracking from accelerometer integration;
- color used as atmosphere without a simulation cause.

## Measurable product targets

| Target | Home MVP measure |
|---|---|
| Causal readability | In a five-second uncaptioned capture, a reviewer can point to the feeding and kill source and distinguish the two outcomes. |
| Vector identity | At normal camera distance, the organism visibly contains at least three grammar elements: nodes/edges, ribbon or branch, and faceted membrane. |
| White-world discipline | In a neutral idle frame, at least 95% of rendered pixels have saturation ≤ 0.12 after tone mapping. |
| Localized emission | Default bloom and saturated color remain within the event path or a 0.25 m world-space halo around it. |
| Simulation | A fixed seed and identical input timeline produce identical state hashes at ticks 0, 300, and 900. |
| Desktop quality | 60 fps target at 1920×1080 for 8 organisms × 256 node slots on the reference desktop tier. |
| Mobile quality | 30 fps target with a 1280 px long-edge render cap for 4 organisms × 128 node slots on the reference mobile tier. |
| Thermal behavior | Mobile maintains the 30 fps tier for a five-minute run without an automatic quality oscillation. |
| Still export | Deterministic PNG export up to 3840×2160 with the active look and no debug UI. |
| State export | Versioned JSON or binary state restores seed, tick, organisms, environment, look, and camera. |
| Input | Every simulation action is available through pointer/touch; motion permission is optional and recoverable. |

Hardware/browser baselines are finalized in P02. If a selected baseline cannot
meet a target, P02 may change organism counts or quality-tier resolution, but it
may not quietly remove deterministic behavior or the visual contract.

## Approval gates

### Gate A — P01 specification

Passes when the required documents exist, all governing choices have an owner,
the reference atlas is accepted, and every acceptance item in issue #2 maps to a
written contract or measurable checklist item.

### Gate B — Home graybox

Passes when one deterministic organism can spawn, navigate neutral obstacles,
feed, take damage, and regenerate in a graybox Home using debug rendering.

### Gate C — Home visual approval

Passes only when all three looks, spectral causality, camera behavior,
performance, replay, and export satisfy
[the Home approval checklist](HOME-APPROVAL-CHECKLIST.md).

### Gate D — Environment adaptations

Forest and Pond each pass their own adaptation gate after Home. They may not be
used to excuse an incomplete Home slice.
