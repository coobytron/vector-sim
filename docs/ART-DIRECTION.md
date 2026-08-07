# Art direction contract

This document is normative. It defines what Spectral Homestead must look and
feel like across environments and rendering backends.

## Governing principles

1. **White is state zero.** The environment is quiet, high-key, and materially
   restrained until a simulation event gives color a reason to exist.
2. **Color explains causality.** Saturated emission is attached to a source,
   path, transfer, or state transition that can be named.
3. **The organism is designed geometry.** It is a legible 3D vector composition,
   not a particle cloud, stock tube, metaball, conventional animal, or glowing
   blob.
4. **Architecture is an actor.** Feeding and damage originate from readable
   architectural surfaces or volumes, not invisible random events.
5. **The three looks expose one truth.** Porcelain Spectrum, Technical Wire, and
   Ghost Volume change representation, not simulation state.

## Composition and white space

- Default scenes reserve 25–45% of the projected frame as calm negative space.
- The organism silhouette must not merge with more than two major architectural
  edges at the default camera preset.
- The Home is framed as a cutaway model, not a first-person corridor.
- Large white planes establish scale; domestic cues remain sparse and abstract.
- Contrast is built with edge density, depth, occlusion, and material response
  before hue.
- Pure black is reserved for diagnostic overlays and is absent from final looks.

## Environment geometry

### Home

Use planar walls, softened thresholds, a stair, table, window, and one or two
sculptural transitions. Furniture is architectural punctuation, not set dressing.
Avoid décor, clutter, fabric realism, lifestyle props, and literal household
branding.

### Forest

Use contour trunks, root planes, layered canopy lines, and simplified terrain.
The forest remains porcelain, not naturally colored. Avoid photoreal bark,
green foliage, fantasy bioluminescence, and dark woodland atmosphere.

### Pond

Use a white sculptural basin, contour bathymetry, inlet, drain, and thin flow
lines. Avoid naturalistic muddy water, blue-water shorthand, fish, reeds, or
decorative caustics unrelated to flow or fields.

## 3D vector-organism grammar

Every hero organism must use at least three of these five grammar families:

| Family | Visible role | Constraint |
|---|---|---|
| Nodes | State anchors and joints | Vary by state; never become a uniform bead chain. |
| Edges | Connectivity and force direction | Hairline-to-structural hierarchy; no undifferentiated spaghetti. |
| Ribbons | Orientation, flow, and local surface | May twist and taper; cannot become a single worm body. |
| Branches | Growth history and directional choice | Must fork from graph state, not decorative random noise. |
| Faceted membranes | Sparse area, protection, or state grouping | Use selectively; never seal the organism into a conventional skin. |

At the Home default camera, a healthy organism should occupy approximately
0.6–1.4 m and expose 12–40 visually dominant nodes even if the underlying graph
contains more active cells. Geometry may be decimated for rendering, but state
and graph identity must remain inspectable.

## Material system

Neutral surfaces use linear-light values. Exact renderer parameters may be
translated by backend, but the visual result must preserve these relationships.

| Element | Base value | Roughness | Opacity | Notes |
|---|---:|---:|---:|---|
| Background | 0.97–1.00 neutral | n/a | 1.00 | No colored vignette. |
| Architecture | 0.88–0.96 neutral | 0.72–0.92 | 1.00 | Matte porcelain; soft grazing response. |
| Neutral obstacles | 0.82–0.92 neutral | 0.65–0.88 | 1.00 | Read by edge and shadow, not hue. |
| Organism nodes | 0.82–0.98 neutral | 0.35–0.70 | 1.00 | Pearl/ceramic, never chrome by default. |
| Edges/ribbons | 0.38–0.82 neutral | 0.45–0.80 | 0.75–1.00 | Hierarchy through value and width. |
| Ghost surfaces | 0.90–1.00 neutral | 0.20–0.55 | 0.08–0.28 | Depth-sorted or weighted blended. |

## Spectral emission contract

The renderer converts a wavelength in the visible range (380–700 nm) to linear
RGB, applies exposure and bloom in linear light, then tone maps once for display.
A hand-picked RGB rainbow may not substitute for the wavelength pipeline.

Spectral order is violet → blue → cyan → green → amber → red. An event may use a
narrow band or a traveling sequence, but may not reorder the spectrum simply for
composition.

| Event | Color behavior | Spatial rule |
|---|---|---|
| Feeding | 410–620 nm sequence moving source → organism | Confined to sampled source, transfer path, and receiving graph edges. |
| Kill/damage | 620–700 nm with a brief 390–430 nm fracture accent | Begins at contact; travels only through affected connectivity. |
| Regeneration | 430–590 nm traveling surviving node → new topology | Ends when the new node/edge reaches stable health. |
| Mutation | One restrained 380–700 nm pulse | Confined to the mutated subgraph; maximum 0.6 s. |
| Field inspection | Low-intensity wavelength bands keyed to channel | Visible only while inspection is explicitly enabled. |
| Idle/navigation | None | White/gray geometry and neutral shadows only. |
| Collision without damage | None | Communicate through deformation or motion, not hue. |

Default saturated color must stay within the causal path or a 0.25 m world-space
halo. Bloom radius at the reference camera is capped at 2% of frame height.
Temporal persistence after an event ends is ≤0.8 s for feeding/regeneration and
≤0.35 s for damage, excluding an intentionally paused inspection view.

## The three looks

### Porcelain Spectrum

The primary authored look. Matte white architecture, soft neutral shadows,
pearl/ceramic nodes, graphite-to-white edges, localized spectral emission, and
restrained bloom. At idle, at least 95% of the frame must have display saturation
≤0.12.

### Technical Wire

A drafting interpretation on white. Architecture uses 0.5–1.5 px projected
construction lines and sparse hidden-edge dashes. Organism adjacency, normals,
field contours, and causal paths may be exposed. Filled surfaces are absent or
≤8% gray. Bloom is ≤50% of Porcelain Spectrum intensity. Debug text and HUD are
not part of the authored look and remain separately toggleable.

### Ghost Volume

A translucent volumetric interpretation exposing field extents, hidden graph
state, and occluded connectivity. Architecture opacity is 0.08–0.22; organism
membranes are 0.12–0.35; primary nodes and active edges remain ≥0.75. Field
volumes use spectral color only when active or inspected. The scene must retain
front-to-back legibility and may not collapse into additive fog.

## Lighting

- Use a broad neutral key and soft ambient fill, equivalent to an overcast studio.
- White balance remains 6000–6800 K across all three looks.
- Contact shadows and ambient occlusion establish grounding; neither may crush to
  black.
- Specular highlights stay neutral unless the surface is currently emitting.
- Exposure is fixed per look. Automatic exposure may not pump in response to an
  emission event.
- Bloom receives emissive buffers only, not ordinary bright white surfaces.

## Motion language

- Healthy growth reads as connected expansion and rebalancing, not Brownian noise.
- Feeding produces a directed wave from the environmental source into the graph.
- Damage produces local tension, disconnect, recoil, and retraction; no gore.
- Regeneration begins at a surviving healthy neighborhood and reconstructs
  topology outward.
- Camera motion is slower than the fastest organism event and uses critically
  damped easing.
- Idle motion amplitude is capped at 2% of organism bounding-box size per second.
- Simulation speed changes do not change the qualitative motion grammar.

## Camera language

The Home hero view uses a 38–46° vertical field of view, elevated three-quarter
cutaway framing, zero default roll, and a visible relationship between organism,
food source, and kill source. Perspective distortion must remain architectural,
not action-camera-like.

Desktop uses orbit/pan/zoom. Touch uses one-finger orbit, two-finger pan, pinch
zoom, and a recenter control. **Motion Look** is opt-in: phone yaw and pitch steer
camera orientation; roll is off by default and may be enabled. Motion Look never
claims physical XYZ translation, always has a touch fallback, and exposes
permission, sensitivity, smoothing, and recenter states.

## Acceptable references and prohibited drift

| Acceptable | Unacceptable drift |
|---|---|
| A white cutaway room with one colored transfer path | A dark room filled with ambient neon or rainbow fog |
| A graph organism combining nodes, edges, ribbons, and membranes | A glowing worm, particle flock, metaball blob, or stock tentacle |
| A wall crack whose color begins at damaging contact | Random sparks or colored damage particles detached from geometry |
| A forest made from white contour trunks and root planes | Photoreal green foliage or a nocturnal bioluminescent garden |
| A pond whose flow is expressed by geometry and field lines | Blue water and decorative caustics with no simulation meaning |
| Translucency that exposes state relationships | Additive glass fog that hides topology |
| Calm architectural cameras and restrained motion response | First-person game camera, excessive roll, shake, or forced gyroscope input |
| Wavelength-derived linear-light emission | Arbitrary RGB gradients chosen only to “look spectral” |

## Reference source

The normative panel mapping and review notes for the generated concept atlas live
in [REFERENCE-ATLAS.md](REFERENCE-ATLAS.md). The atlas is a target for tone,
causal placement, and vector grammar; it is not a literal geometry blueprint.
