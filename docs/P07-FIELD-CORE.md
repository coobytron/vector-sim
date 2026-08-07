# P07a — Deterministic signed-field core

This slice implements the pure environmental-field kernel that Home, Forest, and
Pond all sample. It is the executable form of the signed effect semantics in
[ENVIRONMENT-CONTRACT.md](ENVIRONMENT-CONTRACT.md), the perception channels in
[SIMULATION-CONTRACT.md](SIMULATION-CONTRACT.md), and decision D004 in
[DECISIONS.md](DECISIONS.md).

## Scope

In this slice:

- typed effect-source declarations plus strict validation;
- distance adapters for point, sphere, axis-aligned box, capsule/path segment,
  and plane/surface geometry;
- deterministic point sampling producing independent `food`, `kill`, and
  `netEffect`;
- analytic effect gradient, deterministic contact point/normal, and contributing
  source IDs;
- headless Vitest coverage including golden samples.

Not in this slice: simulation wiring, metabolism, collision, spatial indexing,
mesh-bound fields, depletion, authoring UI, debug rendering, and manifest
parsing. Those land in later P07 slices and in P09.

## Module map

All files live in `src/environments/fields/` and are importable in Node with no
Three.js, DOM, GPU, or network dependency.

| File | Responsibility |
|---|---|
| `types.ts` | `EffectSource`, geometry union, `SignedFieldSample`, `FieldContact`. |
| `math.ts` | Float32 vector helpers, smootherstep and its derivative. |
| `geometry.ts` | `probeGeometry` — one distance/contact/normal contract per shape. |
| `validation.ts` | `validateEffectSources`, `FieldValidationError`. |
| `signedField.ts` | `createSignedEffectField` — the saturating signed union. |
| `gradient.ts` | 1 cm central-difference gradient used as the fallback and cross-check. |
| `index.ts` | Public surface. |

```ts
import { createSignedEffectField, vec3 } from './environments/fields';

const field = createSignedEffectField([
  {
    id: 'threshold-feed',
    strength: 0.8,
    rangeMeters: 0.45,
    geometry: {
      kind: 'box',
      center: vec3(2.7, 0.02, 0.55),
      halfExtentsMeters: vec3(0.425, 0.0125, 0.08),
    },
  },
  {
    id: 'fault-kill',
    strength: -1,
    rangeMeters: 0.3,
    geometry: {
      kind: 'capsule',
      start: vec3(-3.05, 0.35, -0.6),
      end: vec3(-3.05, 1.6, -0.45),
      radiusMeters: 0,
    },
  },
]);

const sample = field.sample(vec3(2.7, 0.2, 0.55));
// sample.food, sample.kill, sample.netEffect, sample.gradient, sample.foodContact
```

## Sampling contract

For each source: `uᵢ = clamp(1 - dᵢ/rᵢ, 0, 1)`, `wᵢ = smootherstep(uᵢ)`,
`aᵢ = clamp(|sᵢ| × wᵢ, 0, 1)`. Positive and negative sources then aggregate
separately with the saturating union `1 - Π(1 - aᵢ)`, and
`netEffect = clamp(F - K, -1, 1)`.

`food` and `kill` are always reported independently. Equal exposure yields
`food = kill = 1` with `netEffect = 0`; nothing cancels before metabolism sees
the two channels. A source with `strength === 0` is neutral and contributes to
neither channel and to no ID list.

### Distance semantics

`distanceMeters` is the distance to the authored surface and is never negative:
a point inside a volume reports `0` with `inside: true`, which means full
authored exposure. A one-sided plane reports `Infinity` behind its normal, so it
contributes nothing there.

A zero-radius capsule is a bare line segment, which is how the Home fault line is
authored.

### Determinism

- Sources are sorted by stable source ID (code-unit order, never locale
  collation) at construction, and every accumulation runs in that order. Float32
  multiplication is commutative but not associative, so fixing the order is what
  makes declaration order irrelevant.
- Every intermediate is quantized with `Math.fround`, including the sampled
  point.
- `-0` is collapsed to `+0` in vector results so contact metadata and future
  tick hashes stay byte-stable.
- Gradient terms use prefix/suffix complement products, so each term is a fixed
  expression rather than an order-dependent division.
- Contact selection takes the largest contribution, with the lowest source ID
  winning a tie.

## Gradient

`sample().gradient` is the analytic ∇`netEffect` in effect units per meter:

```text
∂aᵢ/∂dᵢ = |sᵢ| × 30uᵢ²(1 - uᵢ)² × (-1/rᵢ)
∇F      = Σᵢ Π_{j≠i}(1 - aⱼ) × ∂aᵢ/∂dᵢ × n̂ᵢ
∇E      = ∇F - ∇K
```

`n̂ᵢ` is the outward unit normal of the distance field, so the gradient points
toward food and away from kill. It vanishes exactly on the authored surface and
at or beyond the range, because `smootherstep'` is zero at both endpoints — the
field has no gradient discontinuity at the range boundary.

`gradientDirection` and `gradientMagnitude` are supplied raw. Clamping the
magnitude into the perception layout's `[0, 1]` belongs to the perception
assembler in a later slice, not here.

`centralDifferenceEffectGradient` samples at the contract's 1 cm step. It is the
cross-check in tests and the fallback for any future geometry without a
practical closed form. Box edges and corners are genuine kinks in the distance
function: the analytic value there is a one-sided limit and will not match a
central difference. Tests probe away from those edges deliberately.

## Validation

`validateEffectSources` returns every problem at once instead of failing on the
first, and each issue names the offending source and the dotted field path.
`createSignedEffectField` throws `FieldValidationError` carrying those issues.
Rejected declarations: empty or duplicate IDs, strength outside `[-1, 1]`,
non-positive or non-finite range, unknown geometry kind, non-finite vector
components, non-positive sphere radius, negative capsule radius, negative box
half extents, and a zero-length plane normal.

Sources whose ID cannot be used are reported as `<index n>`.

## Validation commands

```bash
npm run test -- tests/signedField.test.ts   # 28 focused field tests
npm run qa                                   # validators, lint, tests, build
```

## Deferred risk and open questions

- Perception packing (`unit XYZ + magnitude [0,1]`) is intentionally not applied
  here; the reference magnitude used for normalization is a P07b decision.
- `sample()` allocates a result object per call. That is fine for the contract
  and for fixtures, but the per-cell hot path in P07b will likely want a
  fill-into-buffer variant over the same math.
- Obstacle, shelter, habitat, flow, spawn, and exclusion channels are declared in
  the environment contract but are not part of this kernel yet. They combine by
  different rules (minimum signed distance, saturating union, weighted average,
  clamped sum, Boolean union) and belong to the next slice.
- Golden values in the test are exact float32 numbers recorded on this
  implementation. A change to them means the sampling contract moved and needs a
  documented amendment, not a re-record.
