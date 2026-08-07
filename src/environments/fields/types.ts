import type { Vec3 } from './math';

/**
 * Authored geometry an effect source is attached to. Geometry only supplies a
 * distance; it never implies whether a source feeds or kills. That comes from
 * the signed `strength` alone (ENVIRONMENT-CONTRACT.md, decision D004).
 */
export type EffectGeometry =
  | PointGeometry
  | SphereGeometry
  | BoxGeometry
  | CapsuleGeometry
  | PlaneGeometry;

export interface PointGeometry {
  readonly kind: 'point';
  readonly position: Vec3;
}

export interface SphereGeometry {
  readonly kind: 'sphere';
  readonly center: Vec3;
  readonly radiusMeters: number;
}

/** Axis-aligned box described by its center and non-negative half extents. */
export interface BoxGeometry {
  readonly kind: 'box';
  readonly center: Vec3;
  readonly halfExtentsMeters: Vec3;
}

/** Capsule / path segment. A zero radius describes a bare line segment. */
export interface CapsuleGeometry {
  readonly kind: 'capsule';
  readonly start: Vec3;
  readonly end: Vec3;
  readonly radiusMeters: number;
}

/**
 * Infinite plane / surface. Two-sided by default; `oneSided` restricts the
 * effect to the half space the normal points into.
 */
export interface PlaneGeometry {
  readonly kind: 'plane';
  readonly origin: Vec3;
  readonly normal: Vec3;
  readonly oneSided?: boolean;
}

export const EFFECT_GEOMETRY_KINDS = ['point', 'sphere', 'box', 'capsule', 'plane'] as const;

/**
 * One authored `effect` channel entry. `strength > 0` contributes to food,
 * `strength < 0` contributes to kill, and `strength === 0` is neutral.
 */
export interface EffectSource {
  readonly id: string;
  readonly strength: number;
  readonly rangeMeters: number;
  readonly geometry: EffectGeometry;
}

/**
 * Where a contributing source is closest to the sampled point. Used by later
 * slices to place localized emission on the authored surface instead of at the
 * organism center.
 */
export interface FieldContact {
  readonly sourceId: string;
  readonly point: Vec3;
  /** Unit direction from the authored surface toward the sampled point. */
  readonly normal: Vec3;
  readonly distanceMeters: number;
  /** Post-falloff contribution `aᵢ` of this source, in `[0, 1]`. */
  readonly contribution: number;
}

export interface SignedFieldSample {
  /** Saturating union of positive sources, `[0, 1]`. */
  readonly food: number;
  /** Saturating union of negative sources, `[0, 1]`. */
  readonly kill: number;
  /** `clamp(food - kill, -1, 1)`; context only, never a cancellation. */
  readonly netEffect: number;
  /** Analytic ∇(netEffect) in effect units per meter. */
  readonly gradient: Vec3;
  /** Unit gradient direction, or the zero vector when the gradient vanishes. */
  readonly gradientDirection: Vec3;
  /** Raw gradient magnitude per meter; perception assembly does the clamping. */
  readonly gradientMagnitude: number;
  readonly foodSourceIds: readonly string[];
  readonly killSourceIds: readonly string[];
  readonly contributingSourceIds: readonly string[];
  readonly foodContact: FieldContact | null;
  readonly killContact: FieldContact | null;
}

export interface SignedEffectField {
  /** Sources in stable ascending ID order — the evaluation order. */
  readonly sources: readonly EffectSource[];
  sample(point: Vec3): SignedFieldSample;
}
