# P08a — Deterministic lifecycle core and causal event log

This slice turns shared `FieldProvider` samples into energy, damage, viability,
lifecycle status, and a causal event log. It is renderer-independent and
environment-independent: Home, Forest, and Pond differ only by which provider
they hand in.

Not in this slice: visual geometry, emission, spectral colour, trained-NCA
coupling, movement policy, and collision. Repair and lesion state are exposed as
events for the NCA integration to drive — nothing here fakes learned
regeneration.

## Module map

| File | Responsibility |
|---|---|
| `src/lifecycle/types.ts` | State, event, status, and rate contracts. |
| `src/lifecycle/rates.ts` | Rate validation and defaults. |
| `src/lifecycle/lifecycle.ts` | The tick loop, state machine, and event log. |
| `src/lifecycle/population.ts` | Population cap and deterministic spawn selection. |
| `src/lifecycle/index.ts` | Public surface. |

```ts
import { createSignedFieldProvider, vec3 } from './environments/fields';
import { createLifecycleSystem } from './lifecycle';

const lifecycle = createLifecycleSystem({
  provider: createSignedFieldProvider('spectral-home', sources),
});

lifecycle.spawn({ id: 'organism-a', position: vec3(2.7, 0.2, 0.55), seed: 4242 });
lifecycle.step();               // one 30 Hz tick
lifecycle.applyLesion('organism-a', 0.2, 'user-tool');
lifecycle.events();             // causal log, oldest first
```

## Channels consumed

Two generic scalar channels, by ID, from whatever provider is supplied:

| Channel | Range | Effect |
|---|---|---|
| `energy` | `[0, 1]` | Feeding. |
| `danger` | `[0, 1]` | Damage. |

A missing or non-finite channel reads as `0`. No other channel is consulted, and
no environment, mesh, material, or source name is ever interpreted as behavior.

## Rates

Defaults come from the metabolism section of `docs/SIMULATION-CONTRACT.md` and
are all overridable and validated:

```text
intake      = intakePerEnergyUnit × energyChannel        (default 0.20 /s)
expenditure = idleDrainPerSecond                          (default 0.012 /s)
energy'     = clamp(energy + (intake - expenditure) × dt, 0, 1)
damage'     = clamp(damage + damagePerDangerUnit × dangerChannel × dt, 0, 1)
viability   = 1 - damage
```

Feeding and damage integrate independently. Equal exposure feeds and damages on
the same tick; the two never cancel (decision D004).

Repair is requested on every tick where `damage > 0`. It is granted only when
`energy > repairEnergyThreshold` (0.35) **and** `danger < repairDangerCeiling`
(0.05); when refused, the event names which condition blocked it.

`dt` defaults to the contract's fixed 30 Hz tick.

## Status resolution

A single fixed-priority ladder, evaluated top to bottom:

| Priority | Status | Condition |
|---:|---|---|
| 1 | `dead` | A death cause has been recorded. |
| 2 | `dying` | `viability < dyingViability` (0.20). |
| 3 | `stressed` | `danger ≥ stressedDanger` (0.05). |
| 4 | `repairing` | Repair was granted and reduced damage this tick. |
| 5 | `thriving` | `energy ≥ thrivingEnergy` (0.70). |
| 6 | `resting` | `energy ≥ restingEnergy` (0.45). |
| 7 | `searching` | Otherwise. |

The order is total and data-independent, so two runs with the same inputs always
agree on the label. Each change emits one `transition` event carrying the source
context that caused it.

## Death

Death checks run in a fixed order so the recorded cause is deterministic when
both thresholds are crossed on one tick:

1. `damage ≥ 1` → cause `damage`
2. `starvedSeconds ≥ starvationSeconds` → cause `starvation` — **only when an
   authored policy opts in**

`starvedSeconds` accumulates only while energy is exactly zero and resets
otherwise. It is still tracked when starvation death is disabled, so a caller
can observe how long an organism has been empty without that killing it.

### Starvation is opt-in and disabled by default

`SIMULATION-CONTRACT.md` describes no starvation death. Zero energy only means
a cell "may sense and retract but cannot propose a birth or repair", and death
is viability-driven: *"the organism is dead when all core cells are inactive or
the mean core health remains zero for 30 ticks."*

So `starvationSeconds` defaults to `null`. Picking any number would have added a
death mode the contract does not describe, and would have quietly become
canonical the moment something depended on it. Set it to a number to enable the
policy explicitly; `0` kills on the first tick at zero energy.

**Death is terminal.** A dead organism is skipped by `step()`, produces no
further events, and keeps its final state. The only exit is `respawn(id)`, which
is an explicit, logged policy call that increments `generation`. There is no
implicit revival path.

## Causal events

Every event carries `tick`, `timeSeconds`, `organismId`, `sourceIds`, and
`contacts`. Source IDs and contact metadata come straight from the provider
sample, so a later renderer can place an emission on the authored surface that
caused it rather than at the organism centre.

| Kind | Payload |
|---|---|
| `spawn` | `phenotype`, `generation` |
| `intake` | `amount`, `channelValue` |
| `damage` | `amount`, `channelValue` |
| `lesion` | `amount`, `reason` |
| `repair-request` | `requested`, `granted`, `blockedBy` |
| `repair` | `amount` |
| `transition` | `from`, `to` |
| `death` | `cause` |
| `respawn` | `generation` |

The log is bounded by `maxEvents` (default 4096) and drops oldest-first.

## Determinism

- Organisms advance in ascending ID order every tick, so log order is
  reproducible regardless of spawn order.
- All arithmetic is float32-quantized, matching the field kernel.
- Nothing reads a clock or an unseeded random source. `selectSpawnCandidates`
  accepts an explicit seed and is otherwise ordered by score then ID.
- The same script against two providers with different IDs but identical
  channels produces identical state and identical event counts.

## Commands

```bash
npm run test -- tests/lifecycleCore.test.ts
npm run qa
```

## Deferred risk and open questions

- **Movement is caller-driven.** `moveTo` exists so fixtures can script a path;
  this slice has no locomotion policy, and the acceleration/velocity model in
  the simulation contract is not implemented here.
- **Death has no confirmation window.** The contract requires mean core health
  to stay at zero for 30 ticks before an organism counts as dead, but that rule
  is about aggregate health across core cells, which does not exist until the
  graph lands. This slice deactivates at `viability = 0` immediately. Revisit
  when per-cell state arrives.
- **One organism, one sample point.** The contract's real model samples fields
  per cell across a graph. This slice treats an organism as a single point so
  the metabolic contract can be settled before the graph lands; per-cell
  sampling is a P08b concern and will change how intake aggregates.
- **Shelter is not applied.** The contract's `idleDrain × (1 - 0.40 × S)`
  shelter reduction needs a `shelter` channel that the current provider does not
  expose. The rate is implemented without it and should gain it when the channel
  exists.
- **No energy transfer between organisms or cells.** Total-conserving transfer
  is a graph-level operation and waits on the graph.
