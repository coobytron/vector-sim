# P08b lifecycle → presentation

P08a built a renderer-independent lifecycle core that turns provider samples
into energy, damage, viability, status, and a causal event log. P04 built a
per-cell visual decode. P08b is the join: `src/organisms/presentation.ts` is the
only place that reads lifecycle state and produces something a renderer can
consume.

It is a pure function of `(organism, events, tick)` — no UI state, no wall
clock, no randomness, no environment branch — so a scripted fixture always
produces the same presentation signature.

## Status → visual vocabulary

Lifecycle statuses are metabolic; the P04 vocabulary is visual. They are not the
same list, and the mapping is deliberate rather than a rename.

| Lifecycle status | Visual state | Why |
|---|---|---|
| `dead` | `death` | Terminal. Exclusive 620 nm with an intensity fade. |
| `dying` | `dying` | Approaches red; strong retraction. |
| `stressed` | `damaged` | Danger at or above the stressed threshold. |
| `repairing` (granted) | `regenerating` | Damage genuinely fell this tick. |
| `repairing` (blocked) | `damaged` | The request was refused, so nothing recovered. |
| `thriving` / `resting` | `feeding` while intake arrives, else `dormant` | Blue is reserved for an actual transfer, not for being well fed. |
| `searching` | `starving`, or `feeding` while intake arrives | Below resting energy; reduced thickness and ribbon weight. |

## Earned emission

Emission strength is capped by `emissionCeiling` so the renderer cannot claim
recovery the simulation has not produced:

| Condition | Ceiling | Reading |
|---|---:|---|
| Repair requested and refused | 0.34 | A restrained pending seam. |
| Repair granted | 0.68 | Real deterministic repair, short of a full life return. |
| Everything else | 1.00 | Normal. |

Terminal states are never muted. An organism that requested repair on the tick
it died still owns the full 620 nm fade — the ceiling exists to hold back
unearned *recovery*, not to soften damage or death.

The guardrail this encodes: the lifecycle core's repair path really does lower
damage, so reflecting it in thickness and continuity is honest. Structural
regrowth — new nodes, reconnected edges — stays gated on trained-NCA evidence
(#31/#42). This module never invents topology.

## Anchored event phase

`eventPhase` is `(tick - statusSinceTick) / window`, clamped to `[0, 1]`.

It is anchored to the transition that produced the current status, and it is
clamped rather than wrapped. That matters: the free-running `tick / 90` phase
the packer uses for un-driven organisms wraps, which made death re-ignite from
zero to full red every 90 ticks instead of fading once. Windows come from the
temporal-persistence rules in `ART-DIRECTION.md`:

| State | Window |
|---|---:|
| Feeding, regenerating | 0.80 s |
| Mutating | 0.60 s |
| Damaged, dying | 0.35 s |
| Death | 1.50 s fade |

## Localization

`feedFocus` and `damageFocus` carry the contributing source IDs plus the contact
point, normal, and contribution of the strongest contributor, taken from the
lifecycle event's own `contacts`. Ties break on ascending source ID, so the
focus is stable regardless of contact ordering. A tick with no matching event
reports `null` rather than a stale contact.

## Renderer consumption

`applyPresentationToDecodeInput` bridges onto the existing per-cell decode hook,
and `VectorPackOptions.presentations` keys presentation state by organism index.
An explicit `stateOverride` — the deterministic capture route — still wins, so
committed captures stay pinned.

Consumption is currently partial, and the gap is deliberate rather than hidden:

| Channel | Consumer |
|---|---|
| `visualState`, `eventPhase`, `emissionCeiling`, `energy`, `viability` | Wired through the decode hook into thickness, curvature, connectivity, and emission. |
| `thicknessScale`, `continuity` | Expressed indirectly: the decoder derives both from viability and energy. |
| `opacity` | **No renderer consumer.** `DecodedCellVisual.opacity` is computed and discarded today; wiring per-cell alpha needs an instanced-material change. |
| `trailPersistence` | **No renderer consumer.** No trail/history geometry exists yet. |

The last two are contract outputs waiting on renderer work, not dead fields by
accident. See the P04c audit notes on issue #45.

## Commands

```bash
npm run test -- tests/organismPresentation.test.ts
npm run qa
```

## Deferred

- **Organism identity is not yet joined.** `presentations` is keyed by
  morphology organism index; the lifecycle system keys by string ID. Wiring the
  lifecycle system into the simulation snapshot is a separate slice.
- **Per-cell localization.** `feedFocus` / `damageFocus` are per organism. Using
  them to drive emission on specific *nodes* needs the per-cell sampling that
  P08a's own deferred list already calls out.
- **Trails and per-cell alpha.** Both are renderer features, not mapping work.
