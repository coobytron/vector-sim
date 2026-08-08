/**
 * Environmental field kernel.
 *
 * Pure, renderer-independent, and importable in Node: no Three.js, DOM, GPU, or
 * network dependency. P07a supplies the deterministic signed field; P07b adds
 * generalized scalar/vector provider channels around that stable core.
 */
export { probeGeometry } from './geometry';
export type { SurfaceProbe } from './geometry';
export { CENTRAL_DIFFERENCE_STEP_METERS, centralDifferenceEffectGradient } from './gradient';
export {
  FALLBACK_NORMAL,
  ZERO_VEC3,
  clamp,
  clamp01,
  f32,
  smootherstep,
  smootherstepDerivative,
  vec3,
} from './math';
export type { Vec3 } from './math';
export {
  FieldProviderValidationError,
  assertValidProviderManifest,
  createCompositeFieldProvider,
  createRadialScalarProvider,
  createSignedFieldProvider,
  createUniformVectorProvider,
} from './provider';
export type {
  FieldChannelKind,
  FieldChannelManifest,
  FieldProvider,
  FieldProviderManifest,
  FieldSample,
} from './provider';
export { createRasterDatasetProvider } from './rasterDataset';
export type {
  RasterChannel,
  RasterDatasetManifest,
  RasterScalarChannel,
  RasterVectorChannel,
} from './rasterDataset';
export { compareSourceId, createSignedEffectField } from './signedField';
export { EFFECT_GEOMETRY_KINDS } from './types';
export type {
  BoxGeometry,
  CapsuleGeometry,
  EffectGeometry,
  EffectSource,
  FieldContact,
  PlaneGeometry,
  PointGeometry,
  SignedEffectField,
  SignedFieldSample,
  SphereGeometry,
} from './types';
export { FieldValidationError, assertValidEffectSources, validateEffectSources } from './validation';
export type { FieldValidationIssue } from './validation';
