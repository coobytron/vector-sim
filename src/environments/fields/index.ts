/**
 * Signed environmental-field kernel (P07a).
 *
 * Pure, renderer-independent, and importable in Node: no Three.js, DOM, GPU, or
 * network dependency. Home, Forest, and Pond all sample the same kernel.
 * Simulation wiring, authoring UI, and debug rendering are later P07 slices.
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
