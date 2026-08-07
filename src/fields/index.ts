export {
  EnvironmentFieldSampler,
  effectFalloff,
  GRADIENT_STEP_METERS,
  MAX_FLOW_METERS_PER_SECOND,
  OBSTACLE_DISTANCE_CLAMP_METERS,
  type FieldSourceRuntime,
} from './fieldSampler';
export {
  EnvironmentManifestError,
  loadEnvironment,
  validateEnvironmentManifest,
  SPAWN_CLEARANCE_METERS,
  SPAWN_MAX_FOOD,
  SPAWN_MAX_KILL,
  type ManifestValidationOptions,
  type ManifestValidationResult,
} from './manifest';
export { evaluateGeometry, geometryBounds, translateGeometry, type SurfaceQuery } from './shapes';
export { FieldSpatialIndex } from './spatialIndex';
export {
  createFieldSample,
  ENVIRONMENT_SCHEMA_VERSION,
  FIELD_BATCH_CHANNELS,
  FIELD_BATCH_STRIDE,
  REQUIRED_LOOKS,
  type EnvironmentManifest,
  type FieldChannels,
  type FieldGeometry,
  type FieldSample,
  type FieldSourceDescriptor,
  type Vec3,
} from './types';
