# ADR 0002: Linear spectral output

- Status: Accepted
- Decision owner: Implementation owner; creative approval through P03 review
- Governing issue: #4

## Context

Spectral Homestead needs wavelength-ordered emission in a high-key white scene.
Direct RGB ramps, display-space mixing, unconstrained bloom, or multiple output
transfers would make emission decorative and cause inconsistent viewport and
capture results.

## Decision

1. Approximate CIE 1931 XYZ with the continuous Wyman/Sloan/Shirley analytic fit.
2. Hard-clamp every authored emission request to 470–620 nm. Reserve 470 nm blue
   for life and 620 nm red for death.
3. Convert XYZ to linear sRGB, remove negative channels with a neutral lift, and
   peak-normalize chromaticity before applying intensity.
4. Apply a 1.32× source-chroma gain at constant peak intensity.
5. Mix emission and bloom in linear light, then apply per-look saturation
   (+0.18 for Porcelain Spectrum). Neutral inputs remain neutral.
6. Use Three.js `ACESFilmicToneMapping` with fixed per-look exposure.
7. Apply sRGB transfer exactly once in `OutputPass`.
8. Sample the final canvas for live, PNG, and video consumers.

## Consequences

- A wavelength and intensity have one deterministic result across environments.
- Emission can exceed one in the working space without flattening immediately.
- Neutral architecture remains neutral and below the bloom threshold.
- Violet and far-red requests resolve deterministically to the nearest authored
  endpoint instead of entering presentation output.
- Video codecs may add bounded error, but they may not own a separate color
  rendering path.

## Rejected alternatives

- Hand-picked RGB gradients: fail wavelength order and reproducibility.
- Bruton-style display RGB applied directly to materials: mixes in encoded
  space and cannot support HDR bloom consistently.
- Automatic exposure: pumps the white environment when event energy changes.
- Reinhard-only channel compression: clips less gracefully and loses the
  renderer's established ACES output parity.
- Blooming the entire bright scene: makes white architecture glow without a
  causal event.

## Amendment — 2026-08-07 semantic spectrum clamp

- **Owner:** Creative owner, implemented by the P03 implementation owner.
- **Affected contracts:** `ART-DIRECTION.md` spectral emission,
  `SIMULATION-CONTRACT.md` emission output, P03 calibration, semantic events,
  Home transfer/fault emitters, and capture manifest.
- **Decision:** Clamp presentation color to 470–620 nm. Blue at 470 nm means
  life; red at 620 nm means death. Damage may approach but never occupy death
  red, and death has no contradictory blue accent.
- **Migration/replay impact:** No released replay format exists. Any prior P03
  debug wavelength below 470 or above 620 now maps to the nearest endpoint;
  energy, health, event timing, graph state, and deterministic tick hashes are
  unchanged.
- **Home regression:** Feeding and regeneration remain in the blue life band;
  damage stays below 620 nm; death samples exactly 620 nm; calibration and
  export manifests record both anchors. Unit tests enforce all four rules.

## Amendment — 2026-08-07 richer causal color, second grade

- **Owner:** Creative owner, implemented by the P03 implementation owner.
- **Affected contracts:** spectral conversion, post-processing looks, calibration
  reference and manifest, live/PNG/video output descriptor, and P03 tests.
- **Decision:** Raise source chroma to 1.32× and add a pre-ACES per-look
  saturation pass. Porcelain Spectrum uses +0.18, Technical Wire +0.10, and
  Ghost Volume +0.15. High-intensity neutral rolloff starts at 4.25× instead of
  3.25× and contributes less white.
- **Migration/replay impact:** No simulation, wavelength, event, or deterministic
  replay value changes. The grade is presentation metadata only; earlier P03
  captures will render less saturated.
- **Home regression:** Neutral RGB values must remain exactly neutral through
  the saturation stage; life remains blue, death remains red, and each look's
  saturation value is included in the output descriptor and reference manifest.
