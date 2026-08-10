# P06a — Browser checkpoint loader and CPU reference kernel

This slice makes P05a checkpoints executable in the browser: a validated
checkpoint contract, a compact weight container, and a deterministic CPU
reference kernel with the transport controls fixtures and CI need.

It does **not** ship trained weights, GPU/WebGL2 execution, or renderer
integration. Those follow once P05b (#31) produces real checkpoint candidates.

## Module map

Everything lives under `src/nca/` and is importable in Node with no Three.js,
DOM, GPU, or network dependency.

| File | Responsibility |
|---|---|
| `checkpoint/types.ts` | Manifest, container, and error contracts. |
| `checkpoint/sha256.ts` | Synchronous SHA-256 (FIPS 180-4). |
| `checkpoint/loader.ts` | Manifest validation, base64, container loading. |
| `reference/vectorNcaKernel.ts` | `vector_nca_mlp_v1` forward pass. |
| `reference/runtime.ts` | Seed, reset, pause, single-step, lesion, signature. |
| `models/p06a-reference-checkpoint.json` | Committed fixture container. |
| `../scripts/generate-checkpoint-fixture.mjs` | Regenerates that fixture. |

```ts
import { createReferenceRuntime, loadBrowserCheckpoint } from './nca';
import container from './nca/models/p06a-reference-checkpoint.json';

const checkpoint = loadBrowserCheckpoint(container);
const runtime = createReferenceRuntime({ checkpoint, nodes: 32, seed: 1337 });

runtime.step(100);
runtime.applyLesion({ fraction: 0.25 });
runtime.step(200);
runtime.signature(); // stable hash of (tick, state)
```

## Two checksums, two jobs

`manifest.sha256` is the SHA-256 of the source `.pt` file, written by
`save_checkpoint`. The browser never sees that file, so it cannot verify it; the
field travels as provenance.

`container.payloadSha256` is the SHA-256 of the decoded float32 payload. **This
is the checksum the loader verifies** before any weight is executed.

## Container format

```jsonc
{
  "container": "vector-nca-browser.v1",
  "manifest": { /* the P05a .manifest.json, verbatim */ },
  "updateRate": 0.5,
  "tensors": [{ "name": "net.0.weight", "shape": [64, 38], "offset": 0 }],
  "payloadBase64": "…",       // little-endian float32, concatenated
  "payloadSha256": "…"
}
```

Tensor names are PyTorch `state_dict` keys and shapes follow PyTorch's
`Linear.weight = [out, in]`. The required tensor set is derived purely from
manifest dimensions — see `expectedTensorShapes` — so no phenotype adds, removes,
or reshapes a tensor. Branching, Ribbon, and Radial load through one code path.

### Where `updateRate` comes from

`VectorNCA` applies `latent + delta × update_rate`, so inference cannot be
reproduced without it. `save_checkpoint` now writes `update_rate` into the
manifest, and **the manifest is authoritative**.

`container.updateRate` remains as a fallback for checkpoints exported before
that field existed. When both are present they must agree — a container rate
that contradicts the manifest is a `container` validation error rather than a
silent preference.

## Validation order

Structure → manifest → declared shapes → payload length → checksum → finite scan.
Each failure raises `CheckpointValidationError` with a `code`
(`container`, `manifest`, `architecture`, `dtype`, `shape`, `payload`,
`checksum`, `corrupt`) and a message naming what was expected and what arrived.

Unknown manifest fields are preserved rather than rejected, so P05b can add
metadata without breaking the runtime.

## Reference kernel

Mirrors `training/vector_nca/core.py::VectorNCA.forward` exactly:

```text
neighbor = roll(latent, shifts=1, dims=0)   # neighbor[i] = latent[i-1]
delta    = tanh(W2 · tanh(W1 · [latent, neighbor, sensors] + b1) + b2)
latent'  = latent + delta × updateRate
```

The rolled neighbor is P05a's deliberately simple stand-in for the final graph
neighborhood operator. It is part of the architecture identity, so the reference
reproduces it rather than improving on it. When P05b adopts a real neighborhood,
that is a new architecture string and a new kernel branch.

## Transport controls

| Control | Behavior |
|---|---|
| `step(n)` | Advances `n` ticks; a paused runtime advances nothing. |
| `stepOnce()` | Advances one tick regardless of pause — the manual control. |
| `pause()` / `resume()` | Toggles the paused flag. |
| `reset()` | Back to tick 0 with the current seed. |
| `reseed(seed)` | Back to tick 0 with a new seed. |
| `setSensors(…)` | Replaces the `nodes × sensorChannels` sensor field. |
| `applyLesion({ nodeIndices })` | Zeroes exactly those nodes. |
| `applyLesion({ fraction, seed })` | Deterministic selection, ascending order. |
| `signature()` | FNV-1a hash of `(tick, state)` — the fixture signature. |

Every control is a pure function of `(checkpoint, nodes, seed, sensors, lesions
applied)`. No wall clock, no unseeded randomness.

By default the runtime throws a `corrupt` `CheckpointValidationError` naming the
tick at which state stops being finite. Pass `guardNonFinite: false` to study
divergence instead of aborting on it.

## Fixture signatures

The committed fixture (`nodes: 32`, `seed: 1337`, the sensor field in
`tests/referenceRuntime.test.ts`) produces:

| Tick | Signature |
|---:|---|
| 0 | `27dee174` |
| 1 | `07c006eb` |
| 10 | `8b9d541c` |
| 100 | `da63ec7c` |
| 1000 | `acd77645` |

The fixture holds 3,536 float32 weights with payload SHA-256
`39816acacd87e02a19b8ff6c14540e688a40b1cc87c0e3f7b576b73e56f7d01a`. Weights come
from a seeded generator, not a training run — the fixture proves the loader,
checksum, shape, and runtime contracts without putting PyTorch in CI, and
implies nothing about phenotype quality.

## Commands

```bash
node scripts/generate-checkpoint-fixture.mjs   # regenerate (byte-identical)
npm run test -- tests/checkpointLoader.test.ts tests/referenceRuntime.test.ts
npm run qa
```

## Deferred risk

- Cross-environment float parity between PyTorch and this kernel is untested —
  no PyTorch in CI. `Math.tanh` and float32 accumulation order will not be
  bit-identical to Torch. P06b should measure a tolerance against a real
  exported checkpoint before any claim of exact browser/training parity.
- Weight quantization below float32 is not implemented; the container declares
  dtype and would reject anything else today.
- The kernel is a straightforward triple loop. It is fast enough for fixtures
  and CI, but the per-tick browser path will want blocked matrix multiplies or
  the GPU backend.
- `signature()` uses the existing 32-bit FNV-1a `hashState`. Fine for fixture
  identity; a replay-grade hash would want more bits.
