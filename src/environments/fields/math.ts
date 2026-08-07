/**
 * Float32 vector helpers for the signed environmental-field kernel.
 *
 * Every arithmetic result is quantized with `Math.fround` so a sample is a
 * pure function of its float32 inputs. Declaration order is neutralized by the
 * caller (sources are evaluated in stable ID order); this module only
 * guarantees that no intermediate keeps float64 precision.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 };

/** Deterministic direction used when a true normal is undefined. */
export const FALLBACK_NORMAL: Vec3 = { x: 0, y: 1, z: 0 };

export const f32 = Math.fround;

/** Collapses `-0` to `+0` so contact metadata and hashes stay byte-stable. */
function withoutSignedZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return {
    x: withoutSignedZero(f32(x)),
    y: withoutSignedZero(f32(y)),
    z: withoutSignedZero(f32(z)),
  };
}

export function quantize(value: Vec3): Vec3 {
  return vec3(value.x, value.y, value.z);
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(value: Vec3, factor: number): Vec3 {
  const quantized = f32(factor);
  return vec3(value.x * quantized, value.y * quantized, value.z * quantized);
}

export function negate(value: Vec3): Vec3 {
  return vec3(-value.x, -value.y, -value.z);
}

export function dot(a: Vec3, b: Vec3): number {
  return f32(f32(f32(a.x * b.x) + f32(a.y * b.y)) + f32(a.z * b.z));
}

export function length(value: Vec3): number {
  return f32(Math.sqrt(dot(value, value)));
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    f32(a.y * b.z) - f32(a.z * b.y),
    f32(a.z * b.x) - f32(a.x * b.z),
    f32(a.x * b.y) - f32(a.y * b.x),
  );
}

/** Normalizes `value`, returning `fallback` when the length is zero. */
export function normalize(value: Vec3, fallback: Vec3 = FALLBACK_NORMAL): Vec3 {
  const magnitude = length(value);
  if (magnitude === 0 || !Number.isFinite(magnitude)) {
    return fallback;
  }
  return vec3(value.x / magnitude, value.y / magnitude, value.z / magnitude);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return f32(Math.min(maximum, Math.max(minimum, value)));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Smootherstep falloff from ENVIRONMENT-CONTRACT.md:
 * `w = u³ × (u × (u × 6 - 15) + 10)`.
 */
export function smootherstep(u: number): number {
  const amount = clamp01(u);
  const squared = f32(amount * amount);
  const cubed = f32(squared * amount);
  const polynomial = f32(f32(amount * f32(f32(amount * 6) - 15)) + 10);
  return f32(cubed * polynomial);
}

/** Analytic derivative of {@link smootherstep}: `30u²(1 - u)²`. */
export function smootherstepDerivative(u: number): number {
  const amount = clamp01(u);
  if (amount <= 0 || amount >= 1) {
    return 0;
  }
  const squared = f32(amount * amount);
  const complement = f32(1 - amount);
  return f32(f32(30 * squared) * f32(complement * complement));
}

/** Returns a deterministic unit vector perpendicular to `axis`. */
export function perpendicularTo(axis: Vec3, fallback: Vec3 = FALLBACK_NORMAL): Vec3 {
  if (length(axis) === 0) {
    return fallback;
  }
  const direction = normalize(axis, fallback);
  const absX = Math.abs(direction.x);
  const absY = Math.abs(direction.y);
  const absZ = Math.abs(direction.z);
  const reference: Vec3 =
    absX <= absY && absX <= absZ
      ? { x: 1, y: 0, z: 0 }
      : absY <= absZ
        ? { x: 0, y: 1, z: 0 }
        : { x: 0, y: 0, z: 1 };
  return normalize(cross(direction, reference), fallback);
}
