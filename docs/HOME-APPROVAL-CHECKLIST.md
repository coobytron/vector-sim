# Home vertical-slice approval checklist

This is the measurable Gate C review. It is intentionally separate from the
later Forest and Pond gates. P01 defines these checks; implementation issues make
them pass.

## Review fixture

Record before review:

- build commit: `TBD`
- environment manifest checksum: `TBD`
- model ID and checksum: `TBD`
- golden run seed: `TBD in P09`
- desktop baseline/browser: `MacBook Pro / M1 Max / 32 GB / Safari 26.x / 1920×1080`
- mobile baseline/browser: `iPhone 16 Pro / iOS 26.5.2 / Mobile Safari / 1280 px long-edge cap`
- reviewer and date: `TBD`

A check cannot pass from a concept render. It requires the interactive build or
a deterministic capture from the fixture above.

## Environment and field behavior

- [ ] Home loads as a recognizable white cutaway domestic volume with scale in meters.
- [ ] The initial spawn respects 0.20 m obstacle clearance, `K ≤ 0.05`, and `F ≤ 0.10`.
- [ ] The authored threshold produces food and visibly increases local energy.
- [ ] The authored fault produces kill exposure and visibly reduces local health.
- [ ] Simultaneous food and kill increase energy and reduce health; they do not cancel.
- [ ] Neutral stair, table, and boundaries collide without changing health or energy directly.
- [ ] Shelter reduces measured idle drain by 40% at full strength and emits no default color.
- [ ] Habitat changes model input/behavior without directly changing health or energy.
- [ ] Source declaration order produces identical golden samples and tick hashes.

## NCA and organism behavior

- [ ] The running model is a repeated learned local NCA update, not a scripted animation sequence.
- [ ] The organism uses a per-organism graph with stable slots and maximum degree 8.
- [ ] At least three vector grammar families are visible at the Home hero camera.
- [ ] Feeding propagates from source to receiving cells along real connectivity.
- [ ] Damage deactivates local cells/edges according to health and remains spatially local.
- [ ] A damaged non-core branch regenerates from surviving healthy topology through accepted births.
- [ ] A dead organism satisfies the documented core-cell condition and does not regenerate from nothing.
- [ ] Seeded mutation is bounded to genotype ±0.05, replayable, and does not alter model weights.
- [ ] Hidden channels cannot be displayed as arbitrary color in an authored look.

## Visual contract

- [ ] A neutral idle frame has at least 95% of pixels at display saturation ≤0.12.
- [ ] Saturated default emission stays on its causal path or within a 0.25 m halo.
- [ ] Bloom radius is no more than 2% of frame height at the reference camera.
- [ ] Feeding, damage, regeneration, and mutation follow their wavelength/timing contracts.
- [ ] Idle navigation and non-damaging collision remain white/gray.
- [ ] Architecture reads through plane, edge, occlusion, and neutral material—not decorative hue.
- [ ] The organism does not read primarily as particles, a worm/tube, metaball, or conventional creature.
- [ ] A grayscale review preserves source, obstacle, organism, and depth readability.

## Rendering looks

- [ ] Porcelain Spectrum satisfies its material, exposure, saturation, and localized-bloom contract.
- [ ] Technical Wire distinguishes authored edges, graph adjacency, and field contours.
- [ ] Technical Wire bloom is no more than 50% of Porcelain Spectrum intensity.
- [ ] Ghost Volume exposes hidden field/graph relationships while retaining depth order.
- [ ] Switching among all three looks does not advance or alter simulation state.
- [ ] A still from each look can be matched to the same tick and camera transform.

## Camera and input

- [ ] Home hero view frames organism, feeding source, and kill source together at 38–46° vertical FOV.
- [ ] Desktop orbit, pan, zoom, and recenter operate within authored safe bounds.
- [ ] Touch orbit, pan, pinch zoom, and recenter expose every required camera action.
- [ ] Motion Look starts only after explicit permission and preserves touch on denial/error.
- [ ] Motion Look maps yaw/pitch through a screen-corrected quaternion; roll is off by default.
- [ ] Motion Look clamps, smoothing, sensitivity, and recenter match the environment contract.
- [ ] Motion or camera changes do not change tick hashes.
- [ ] Reduced-motion behavior and roll policy resolve decision D018 before approval.

## Performance and stability

- [ ] Desktop baseline sustains the target 60 fps at 1920×1080 with 8 × 256 slots.
- [ ] Desktop 95th-percentile frame time and GPU/CPU breakdown are recorded.
- [ ] Mobile baseline sustains 30 fps at the 1280 px cap with 4 × 128 slots.
- [ ] Mobile holds its tier for five minutes without repeated quality oscillation.
- [ ] Quality reduction changes render cost only and preserves field/lifecycle semantics.
- [ ] Lost focus, resize, orientation change, and motion-permission transitions recover cleanly.

## Determinism, replay, and export

- [ ] The same fixture reproduces state hashes at ticks 0, 300, and 900.
- [ ] Replay restores model, manifest, assets, seed, tier, inputs, and starting tick.
- [ ] Camera/look are recorded but excluded from the simulation hash.
- [ ] State export round-trips with no semantic difference.
- [ ] PNG export reaches 3840×2160, uses the active look, and omits debug UI.
- [ ] The selected video path exports 1920×1080 at 30 fps from recorded ticks or documents its approved fallback.

## Uncaptioned readability test

Show a five-second Porcelain Spectrum capture to at least three reviewers who
have not read the field contract.

- [ ] At least 2/3 correctly identify the feeding source.
- [ ] At least 2/3 correctly identify the damaging source.
- [ ] At least 2/3 describe the feeding and damage outcomes as different.
- [ ] No more than 1/3 describe the organism primarily as particles or a worm.

## Gate record

Gate C passes only when every required item above is checked or has a linked,
owner-approved exception with expiry and follow-up issue.

**Result:** `NOT REVIEWED`  
**Creative approval:** `TBD`  
**Technical approval:** `TBD`  
**Linked evidence:** `TBD`
