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
| D010 | Open — P02 | Select WebGPU compute, GPU render-texture, WASM/CPU, or hybrid runtime backend and fallback policy. | Implementation owner | Benchmark against the defined desktop/mobile budgets before architecture lock. |
| D011 | Open — P02 | Name exact desktop and mobile reference browser/hardware baselines. | Creative + implementation owners | Performance counts require reproducible devices and browser versions. |
| D012 | Open — P03 | Select the wavelength-to-linear-RGB approximation and tone-mapping operator. | Implementation owner; creative approval | Must preserve ordered spectral behavior and the art-direction measures. |
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
