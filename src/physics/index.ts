/**
 * Spatial-query layer (P14 Jolt spike).
 *
 * `SpatialQueryWorld` is the whole public surface. `joltWorld.ts` is the only
 * module that names Jolt; everything else — including this barrel — deals in
 * authored string IDs and plain vectors, so the engine can be swapped or
 * removed without touching NCA, field, lifecycle, or renderer code.
 *
 * `createJoltSpatialWorld` is intentionally NOT re-exported here: importing it
 * pulls the WASM glue into the module graph. Import it directly from
 * `./physics/joltWorld` at the one place that opts into physics.
 */
export { createNullSpatialWorld } from './nullWorld';
export { PORCELAIN_TEST_SCENE } from './porcelainScene';
export { SPATIAL_CHANNELS, createSpatialFieldProvider, normalizeObservation } from './spatialProvider';
export { PROBE_RANGE_METERS, SpatialWorldError, validateScene } from './types';
export type {
  BodyRole,
  ProxyDescriptor,
  ProxyObservation,
  RayObservation,
  RayQuery,
  SceneDescriptor,
  SpatialQueryWorld,
  StaticBodyDescriptor,
  StaticShape,
} from './types';
