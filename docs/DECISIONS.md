# Decision log

Open choices must be visible, owned, and resolved in the issue named below. No
implementation may silently decide an open item by accident.

| ID | Status | Decision | Owner | Rationale / resolution gate |
|---|---|---|---|---|
| D001 | Accepted | NCA means Neural Cellular Automata. | Creative owner | Matches the intended learned local growth/regeneration model. |
| D002 | Accepted | Use a per-organism dynamic sparse graph, not a shared world grid. | Creative + implementation owners | Preserves 3D vector identity, bounded cost, and organism-local regeneration. |
| D003 | Accepted | Store 24 hidden channels per cell; visible geometry is decoded separately. | Implementation owner | Enough latent capacity for the MVP while keeping the state budget explicit. Revisit only with P02/P05 evidence. |
| D004 | Accepted | Keep positive food `F` and negative kill `K` separate; expose `E = F - K` only as context. | Implementation owner | Equal food/kill must feed and damage simultaneously, not cancel. |
| D005 | Accepted | Idle/navigation stay white; spectral color is limited to transfer, damage, regeneration, mutation, or inspection. | Creative owner | Color must communicate causality. |
| D006 | Accepted | Home is the MVP approval gate; Forest then Pond are contract adaptations. | Creative owner | Protects focus and makes the shared system testable before expansion. |
| D007 | Accepted | Simulation runs at fixed 30 Hz with deterministic seeded asynchronous updates. | Implementation owner | Separates reproducible simulation from display refresh. |
| D008 | Accepted | Runtime uses fixed-capacity graph slots with stable IDs and deterministic proposal resolution. | Implementation owner | Avoids allocator/thread order affecting replay. |
| D009 | Accepted | Mutation changes an 8-value genotype only; runtime model weights remain fixed. | Creative + implementation owners | Keeps mutation visible/replayable without online training. |
| D010 | Accepted — P02 | Use a headless typed-array CPU reference as deterministic truth and fallback, with WebGL2/Three.js instanced vector rendering. Keep WebGPU compute progressive and optional; use WASM only if the same reference ABI misses an on-device budget. | Implementation owner | The paired reference fixture is well below its 30 Hz CPU budget on the committed host result; sparse dynamic graph topology maps more directly to the reference representation than dense ping-pong textures. Browser probes remain evidence, not simulation truth. See `adr/0001-runtime-backend.md`. |
| D011 | Accepted — P02 | Desktop baseline: MacBook Pro, M1 Max, 32 GB, Safari 26.x at 1920×1080. Mobile baseline: iPhone 16 Pro, iOS 26.5.2 Mobile Safari, 1280 px long-edge cap. | Creative + implementation owners | These are the creator's actual desktop and phone and make performance captures reproducible. Browser benchmark JSON must record exact user agent, viewport, DPR, and date. |
| D012 | Accepted — P03, amended | Use the continuous Wyman/Sloan/Shirley analytic CIE 1931 fit, hard-clamp authored emission to 470–620 nm, reserve 470 nm blue for life and 620 nm red for death, then use XYZ-to-linear-sRGB conversion, neutral-lift spectral gamut mapping, fixed per-look exposure, Three.js ACES filmic tone mapping, and one final sRGB transfer. | Creative owner + implementation owner | Preserves an unambiguous life/death color axis, HDR detail, neutral whites, and viewport/capture parity. See the 2026-08-07 amendment in `adr/0002-linear-spectral-output.md`. |
| D013 | Open — P05 | Choose training curriculum, loss terms, and number of shipped phenotypes. | ML implementation owner; creative approval | Must produce visible graph growth, damage, and regeneration without scripted mesh replacement. |
| D014 | Open — P06 | Define model weight container, quantization, checksum, and browser loading format. | Implementation owner | Must preserve model/version identity in replay. |
| D015 | Open — P09 | Finalize Home geometry, exact source placements, and golden run seed. | Art + implementation owners | Requires a graybox review using this contract. |
| D016 | Open — P14 | Choose deterministic video export container/codec and fallback. | Implementation owner | Target is 1920×1080 at 30 fps; browser support must be measured. |
| D017 | Accepted | Motion Look provides rotational yaw/pitch/optional roll only, with touch fallback and recenter. | Creative owner | Honest browser sensor behavior; physical XYZ translation is out of scope. |
| D018 | Open — accessibility review | Decide reduced-motion defaults and whether roll can ever auto-enable. | Creative owner | Must be resolved before Home visual approval. |

## Change rule

An accepted decision changes only through a documented amendment that names the
affected contract sections, migration/replay impact, owner, and Home regression
test. Closing a downstream issue is not sufficient evidence by itself.
