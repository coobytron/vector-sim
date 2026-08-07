import {
  FALLBACK_NORMAL,
  clamp,
  dot,
  f32,
  length,
  negate,
  normalize,
  perpendicularTo,
  quantize,
  scale,
  subtract,
  vec3,
} from './math';
import type { Vec3 } from './math';
import type {
  BoxGeometry,
  CapsuleGeometry,
  EffectGeometry,
  PlaneGeometry,
  PointGeometry,
  SphereGeometry,
} from './types';

/**
 * Distance from a sampled point to an authored surface or volume, plus the
 * contact metadata every shape must supply. `distanceMeters` is never negative:
 * points inside a volume report `0` and `inside: true`.
 */
export interface SurfaceProbe {
  readonly distanceMeters: number;
  readonly contactPoint: Vec3;
  /** Unit direction from `contactPoint` toward the sampled point. */
  readonly normal: Vec3;
  readonly inside: boolean;
}

function probePoint(geometry: PointGeometry, point: Vec3): SurfaceProbe {
  const center = quantize(geometry.position);
  const delta = subtract(point, center);
  const distance = length(delta);
  return {
    distanceMeters: distance,
    contactPoint: center,
    normal: distance === 0 ? FALLBACK_NORMAL : normalize(delta),
    inside: distance === 0,
  };
}

function probeSphere(geometry: SphereGeometry, point: Vec3): SurfaceProbe {
  const center = quantize(geometry.center);
  const radius = f32(geometry.radiusMeters);
  const delta = subtract(point, center);
  const centerDistance = length(delta);
  const normal = centerDistance === 0 ? FALLBACK_NORMAL : normalize(delta);
  return {
    distanceMeters: f32(Math.max(0, f32(centerDistance - radius))),
    contactPoint: vec3(
      center.x + f32(normal.x * radius),
      center.y + f32(normal.y * radius),
      center.z + f32(normal.z * radius),
    ),
    normal,
    inside: centerDistance <= radius,
  };
}

function probeBox(geometry: BoxGeometry, point: Vec3): SurfaceProbe {
  const center = quantize(geometry.center);
  const half = quantize(geometry.halfExtentsMeters);
  const delta = subtract(point, center);
  const overshoot = vec3(
    Math.abs(delta.x) - half.x,
    Math.abs(delta.y) - half.y,
    Math.abs(delta.z) - half.z,
  );
  const outside = vec3(
    Math.max(0, overshoot.x),
    Math.max(0, overshoot.y),
    Math.max(0, overshoot.z),
  );
  const distance = length(outside);
  const inside = overshoot.x <= 0 && overshoot.y <= 0 && overshoot.z <= 0;

  // Nearest face, resolved in stable x, y, z order so ties never depend on
  // floating point noise.
  const nearestAxis =
    overshoot.x >= overshoot.y && overshoot.x >= overshoot.z ? 0 : overshoot.y >= overshoot.z ? 1 : 2;
  const axisDelta = nearestAxis === 0 ? delta.x : nearestAxis === 1 ? delta.y : delta.z;
  const axisSign = axisDelta < 0 ? -1 : 1;
  const faceNormal = vec3(
    nearestAxis === 0 ? axisSign : 0,
    nearestAxis === 1 ? axisSign : 0,
    nearestAxis === 2 ? axisSign : 0,
  );

  const clampedX = clamp(delta.x, -half.x, half.x);
  const clampedY = clamp(delta.y, -half.y, half.y);
  const clampedZ = clamp(delta.z, -half.z, half.z);
  const local = inside
    ? vec3(
        nearestAxis === 0 ? f32(axisSign * half.x) : clampedX,
        nearestAxis === 1 ? f32(axisSign * half.y) : clampedY,
        nearestAxis === 2 ? f32(axisSign * half.z) : clampedZ,
      )
    : vec3(clampedX, clampedY, clampedZ);
  const contactPoint = vec3(center.x + local.x, center.y + local.y, center.z + local.z);

  return {
    distanceMeters: distance,
    contactPoint,
    normal: distance === 0 ? faceNormal : normalize(subtract(point, contactPoint), faceNormal),
    inside,
  };
}

function probeCapsule(geometry: CapsuleGeometry, point: Vec3): SurfaceProbe {
  const start = quantize(geometry.start);
  const end = quantize(geometry.end);
  const radius = f32(geometry.radiusMeters);
  const axis = subtract(end, start);
  const axisLengthSquared = dot(axis, axis);
  const travel =
    axisLengthSquared === 0 ? 0 : clamp(f32(dot(subtract(point, start), axis) / axisLengthSquared), 0, 1);
  const axisPoint = vec3(
    start.x + f32(axis.x * travel),
    start.y + f32(axis.y * travel),
    start.z + f32(axis.z * travel),
  );
  const delta = subtract(point, axisPoint);
  const axisDistance = length(delta);
  const normal =
    axisDistance === 0
      ? axisLengthSquared === 0
        ? FALLBACK_NORMAL
        : perpendicularTo(axis)
      : normalize(delta);

  return {
    distanceMeters: f32(Math.max(0, f32(axisDistance - radius))),
    contactPoint: vec3(
      axisPoint.x + f32(normal.x * radius),
      axisPoint.y + f32(normal.y * radius),
      axisPoint.z + f32(normal.z * radius),
    ),
    normal,
    inside: axisDistance <= radius,
  };
}

function probePlane(geometry: PlaneGeometry, point: Vec3): SurfaceProbe {
  const origin = quantize(geometry.origin);
  const normal = normalize(quantize(geometry.normal));
  const signedDistance = dot(subtract(point, origin), normal);
  const contactPoint = subtract(point, scale(normal, signedDistance));
  const behind = signedDistance < 0;
  const distanceMeters =
    geometry.oneSided === true && behind ? Number.POSITIVE_INFINITY : f32(Math.abs(signedDistance));

  return {
    distanceMeters,
    contactPoint,
    normal: behind ? negate(normal) : normal,
    inside: signedDistance === 0,
  };
}

/**
 * Shared distance adapter. Every supported shape resolves to the same probe
 * contract so one sampling path serves all of them.
 */
export function probeGeometry(geometry: EffectGeometry, point: Vec3): SurfaceProbe {
  switch (geometry.kind) {
    case 'point':
      return probePoint(geometry, point);
    case 'sphere':
      return probeSphere(geometry, point);
    case 'box':
      return probeBox(geometry, point);
    case 'capsule':
      return probeCapsule(geometry, point);
    case 'plane':
      return probePlane(geometry, point);
  }
}
