# Roadmap — reset plan

This roadmap re-orders the project around its single largest risk: whether a
learned graph NCA can produce a living, bounded organism at all. It replaces the
P01–P14 phase sequence for planning purposes. The governing contracts in
`docs/` still define *what* the product is; this file defines *the order* in
which it is proven.

## Why reset the order

As of 2026-09-26 the repository has a spectral color pipeline, three looks,
three organism phenotypes, three Home presets, authored cameras, benchmark
harnesses, browser parity receipts, and a Jolt physics spike. It does not yet
have a trained NCA that can be promoted to Home: four training campaigns
(`training/evidence/`) ended with "no checkpoint selected", and the latest (v4)
recovers at 512 ticks but diverges by 2,048. Home still runs the reference NCA.

Most of the system was built around the component that is least certain to
work. The rule for this roadmap: **nothing is widened until the thing in the
middle is alive.**

## Principles

1. **De-risk first.** Prove the NCA (or its replacement) before polishing
   anything that depends on it.
2. **Vertical slices.** Every milestone ends with something visible in the
   browser, not only an evidence document.
3. **One of each until it lives.** One phenotype, one look, one preset, one
   camera. Multiplicity comes after approval of the single case.
4. **Targets gate features that exist.** Performance, saturation, and export
   targets from the brief remain, but each is enforced only once its feature
   ships.
5. **One line of work at a time.** No parallel branches building the periphery
   while the core is unresolved.
6. **Every PR is reviewable on screen.** A preview deploy per PR so the creative
   owner judges the build, not a write-up.

## Keep

These decisions were correct and carry forward unchanged:

- Headless typed-array CPU simulation as deterministic truth (D010).
- Fixed 30 Hz tick with seeded, deterministic updates (D007, D008).
- Separate food `F` and kill `K`; never let them cancel (D004).
- Color only when a simulation event earns it (D005).
- Per-organism sparse graph, not a world grid (D002).
- Home before Forest and Pond (D006).
- The existing lifecycle core, field providers, and spectral color math — they
  are reusable as-is once the organism is alive.

## Cut or defer

| Item | Action | Reason |
|---|---|---|
| Jolt physics (`src/physics/`, `jolt-physics` dependency) | Defer; remove from the Home path | A 12 × 8 × 3 m room of boxes needs analytic box/SDF queries, not a physics engine. The brief lists "general-purpose physics sandbox" as a non-goal. |
| WebGL2 ping-pong / transform-feedback probes | Defer | Evidence for a GPU path the CPU reference already makes unnecessary at MVP scale. |
| Browser parity receipt subsystem | Shrink to one golden-vector test | A tiny MLP with JSON weights needs one "same input → same output" test, not a harness. |
| Host-specific PNG capture baselines (D021) | Drop until an embedded font exists | They fail across hosts for reasons unrelated to the simulation. |
| `validate:p01`–`validate:p04` in `npm run qa` | Remove from QA | They check the document process, not the product. |
| `living-plate.html` at repo root | Delete or move to `assets/` | Stray 153 KB artifact. |
| Ribbon and Radial phenotypes, Technical/Ghost looks, extra presets | Freeze (keep code, stop extending) | Return in M5 after one organism is approved. |

## Milestones

Each milestone has an exit test. The next one does not start until the exit
test passes or the fallback is taken.

### M1 — Can the NCA live? (go / no-go)

Work entirely in `training/`, one phenotype (Branching), no browser.

- Adopt the standard growing-NCA recipe:
  - **Sample pool training** — persist a pool of evolved states and train from
    them, so the model sees mature states. This directly targets the v4
    finding ("needs exposure to mature states and bounded long-run dynamics").
  - **Damage during training** — lesion a fraction of pool samples each batch.
  - **Stochastic per-cell updates** (already present as `update_rate`).
  - **Overflow penalty** on state magnitude to keep dynamics bounded.
- Condition on the six sensor channels so `F` and `K` change behavior.

**Exit test:** from a single seed the organism grows to its target, responds in
opposite directions to positive and negative fields, recovers ≥ 75% from a 25%
lesion, and stays finite and bounded (max |state| does not trend upward) at
4,096 ticks — evaluated on held-out seeds and lesion positions.

**Time box:** two weeks. **Fallback:** if the exit test fails, ship
hand-authored local update rules with the same graph ABI and lifecycle
contract. The brief's goal — "calm, quietly alive" — does not require a learned
model, and D013 can be resolved as "learned model is a later upgrade".

### M2 — Graybox loop in the browser (Gate B)

- Load the M1 model (or fallback rules) as plain JSON weights into the CPU
  reference runtime; one golden-vector parity test.
- One organism, one box room, one food doorway, one kill wall, debug line
  rendering only.
- Organism spawns, navigates, feeds, is damaged, regrows.

**Exit test:** Gate B from `docs/PROJECT-BRIEF.md`, plus identical state hashes
at ticks 0, 300, and 900 for a fixed seed.

### M3 — Home, one look

- Real Home geometry from one preset, with shelter and habitat regions and
  neutral obstacles (stair, table, boundaries).
- Porcelain Spectrum look only, one authored camera plus orbit/touch.
- Replace Jolt queries with analytic box/SDF collision for Home.

**Exit test:** the Environment and field behavior section of
`docs/HOME-APPROVAL-CHECKLIST.md` passes in the interactive build.

### M4 — Causal color, replay, export

- Spectral emission tied only to feeding, damage, and regeneration events.
- Seed/replay, versioned state export, deterministic PNG export.

**Exit test:** the five-second uncaptioned readability test and the 95%
white-pixel rule from the brief's measurable targets.

### M5 — Widen

Only after M4 is approved by the creative owner:

- Technical Wire and Ghost Volume looks.
- Ribbon and Radial phenotypes, trained with the M1 recipe.
- Remaining Home presets and authored cameras; Motion Look.

### M6 — Performance and approval (Gate C)

- Measure on the baseline devices (D011): 60 fps desktop, 30 fps mobile, and
  the five-minute thermal run.
- Full Home approval checklist review.

### After Gate C

Forest, then Pond, as contract adaptations (Gate D).

## Process

- Each milestone is one tracking issue; each PR is a thin slice within it.
- A PR states which exit test it moves forward.
- Preview deploy on every PR (e.g. GitHub Pages) with the relevant URL
  parameters in the PR description.
- Specs live in the existing `docs/`; add an ADR only for a costly or reversed
  decision. No new phase documents.
