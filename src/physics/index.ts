/**
 * Spatial-query layer.
 *
 * The backend-neutral contract in `types.ts` and the null fallback come from
 * PR #38; `joltSpatialQueryWorld.ts` is the P14b Jolt implementation of it and
 * the only module that names Jolt.
 *
 * `JoltSpatialQueryWorld` is intentionally NOT re-exported here: importing it
 * pulls the WASM glue into the module graph. Import it directly from
 * `./physics/joltSpatialQueryWorld` at the one place that opts into physics.
 */
export { normalizeSpatialObservations } from './normalizeObservations';
export { NullSpatialQueryWorld } from './nullSpatialQueryWorld';
export { PORCELAIN_TEST_SCENE } from './porcelainScene';
export type {
  RayQuery,
  SpatialObservation,
  SpatialObservationKind,
  SpatialQueryWorld,
  SphereQuery,
  Vec3Like,
} from './types';
