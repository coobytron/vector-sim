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

1. Approximate CIE 1931 XYZ from 380–780 nm with the continuous Wyman/Sloan/
   Shirley analytic fit.
2. Convert XYZ to linear sRGB, remove negative channels with a neutral lift, and
   peak-normalize chromaticity before applying intensity.
3. Hold the nearest reliable analytic chromaticity at the numerical tails while
   independently attenuating visible energy.
4. Mix emission, bloom, and exposure in linear light.
5. Use Three.js `ACESFilmicToneMapping` with fixed per-look exposure.
6. Apply sRGB transfer exactly once in `OutputPass`.
7. Sample the final canvas for live, PNG, and video consumers.

## Consequences

- A wavelength and intensity have one deterministic result across environments.
- Emission can exceed one in the working space without flattening immediately.
- Neutral architecture remains neutral and below the bloom threshold.
- Extreme spectral colors are display approximations because sRGB cannot contain
  the full spectral locus.
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
