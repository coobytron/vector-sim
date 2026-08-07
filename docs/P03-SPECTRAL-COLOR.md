# P03 spectral color pipeline

P03 establishes one output path for the live renderer, calibration tools, PNG
captures, and the future video encoder. Wavelength, intensity, and event meaning
are simulation-facing data. Display RGB is never authored by hand.

![Spectral calibration reference](../assets/reference/spectral-calibration-reference.png)

## Pipeline

```mermaid
flowchart TD
  A[Wavelength + intensity] --> B[CIE 1931 analytic fit]
  B --> C[XYZ to linear sRGB]
  C --> D[Spectral gamut map]
  D --> E[HDR emission + linear bloom]
  E --> F[Fixed exposure]
  F --> G[ACES filmic tone map]
  G --> H[One sRGB output transfer]
```

All color values before the final transfer are linear-light values. Neutral
material colors, spectral emission, additive paths, bloom, exposure, and ACES
operate before sRGB encoding. The final `OutputPass` performs the only display
transfer.

## Wavelength conversion

`src/spectral/color.ts` uses the analytic CIE 1931 2° color-matching-function fit
described by Wyman, Sloan, and Shirley, followed by the standard XYZ-to-linear-
sRGB matrix.

The spectral locus exceeds the sRGB gamut. The implementation adds the smallest
neutral component required to remove negative channels, then peak-normalizes the
result. This retains channel ordering while keeping intensity an independent
parameter.

The conversion accepts 380–780 nm. The compact analytic fit becomes unreliable
once every component approaches zero, so chromaticity is held at the nearest
reliable endpoint from 380–400 nm and 660–780 nm while energy is attenuated at
the visible boundary. Authored event semantics remain within 380–700 nm, as
required by the art-direction contract.

## HDR intensity and white-energy behavior

Spectral chromaticity is multiplied by event intensity in linear light. Above
3.25×, a controlled neutral component increases smoothly. ACES then rolls the
highlight toward white without clipping every channel to the same value. This
makes a hot emission look optically saturated while retaining internal hue and
gradient structure.

The default Porcelain Spectrum settings are:

| Setting | Value |
|---|---:|
| Exposure | 0.86 |
| Bloom strength | 0.34 |
| Bloom radius | 0.12 |
| Bloom threshold | 1.00 linear |
| Working space | Linear sRGB |
| Tone map | Three.js ACES filmic |
| Output transfer | sRGB, once |

Ordinary white architecture stays below the bloom threshold. Only the dedicated
HDR emissive node, graph-edge, source, fault, and transfer-path layers feed the
bloom pass.

## Semantic event system

Color is paired with a different spatial motion and form response for every
semantic state. Hue is never the only distinction.

| Event | Wavelength behavior | Motion | Form cue |
|---|---|---|---|
| Feeding | 410–620 nm ordered sweep | Source → agent | Directed transfer wave |
| Hazard | Restrained 592–628 nm band | Held at boundary | Stationary tension |
| Damage | 700–620 nm plus brief 410 nm accent | Contact → graph | Fracture and recoil |
| Regeneration | 430–590 nm ordered sweep | Survivor → growth | Outward reconstruction |
| Mutation | One 380–700 nm traversal | Confined subgraph pulse | Topology pulse |
| Death | 700–665 nm fade plus brief 400 nm accent | Collapse → source | Retraction and extinction |
| Inspection | Low-intensity 440–610 nm band | Static channel band | Diagnostic only |

In the current Home graybox, the feeding threshold emits an ordered wave along a
named transfer path. The damage fault holds red/fracture energy at the wall. NCA
nodes and graph edges emit only when their energy rises above the neutral
baseline or health falls below one.

## Looks

P03 supplies one spectral response profile for each future authored look. P12
will complete the material and geometry representation of those looks.

| Look | Exposure | Bloom | Emission scale | Intent |
|---|---:|---:|---:|---|
| Porcelain Spectrum | 0.86 | 0.34 | 1.00 | Primary causal emission |
| Technical Wire | 0.94 | 0.14 | 0.58 | Suppressed drafting response |
| Ghost Volume | 0.78 | 0.27 | 0.82 | State visible inside translucent forms |

Changing a look never changes wavelength, event state, NCA state, or the neutral
balance of white material inputs.

## Calibration and debug route

Open `?calibration=1` to display:

- 17 wavelength swatches across 380–780 nm;
- six emission strengths from 0.25× through 8×;
- neutral-white comparison plates;
- six semantic motion/form markers;
- a live probe for wavelength, intensity, and exposure;
- **Linear RGB**, **Display RGB**, tone-map, and output-stage readouts.

The `look` query or UI control accepts `porcelain`, `technical`, or `ghost`. The
**Save PNG** control captures the final canvas after bloom, ACES, and sRGB output.

Run `npm run capture:spectral` to regenerate the committed 1536×1024 CPU contract
reference. Its dimensions, SHA-256 digest, wavelength range, tone-map name, and
single-output-transfer rule are recorded next to the PNG in
`assets/reference/spectral-calibration-reference.json`.

## Live, PNG, and video agreement

Live output is the post-processed WebGL canvas. PNG export calls `toBlob()` on
that same canvas; no second shader or color conversion is involved. The video
handoff exposes `canvas.captureStream()` from the same final canvas, so P14 can
encode frames without re-rendering them through another transfer function.

The verification tolerance is:

- live vs PNG: at most 1/255 per decoded sRGB channel, excluding browser
  compositing outside the canvas;
- live vs decoded video: target mean absolute error at most 2/255 per sRGB
  channel, with local codec error permitted but no systematic gamma shift;
- neutral patches: maximum channel spread 1/255 in lossless PNG and 2/255 in
  decoded video.

P14 owns codec/container selection and will record decoded video evidence against
this contract. It may not introduce a second gamma pass.
