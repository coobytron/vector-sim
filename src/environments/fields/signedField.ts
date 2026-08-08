import { probeGeometry } from './geometry';
import type { SurfaceProbe } from './geometry';
import {
  ZERO_VEC3,
  clamp,
  clamp01,
  f32,
  length,
  normalize,
  quantize,
  smootherstep,
  smootherstepDerivative,
  vec3,
} from './math';
import type { Vec3 } from './math';
import type { EffectSource, FieldContact, SignedEffectField, SignedFieldSample } from './types';
import { assertValidEffectSources } from './validation';

interface PreparedSource {
  readonly source: EffectSource;
  /** `abs(strength)`, quantized to float32. */
  readonly magnitude: number;
  /** `1 / rangeMeters`, quantized to float32. */
  readonly inverseRange: number;
}

interface EvaluatedSource {
  readonly entry: PreparedSource;
  readonly probe: SurfaceProbe;
  /** Post-falloff contribution `aᵢ`. */
  readonly contribution: number;
  readonly distanceDerivative: number;
  /** Π(1 - aⱼ) for sources ordered before this one. */
  readonly complementBefore: number;
  /** Π(1 - aⱼ) for sources ordered after this one. */
  complementAfter: number;
}

interface ChannelResult {
  readonly value: number;
  readonly gradient: Vec3;
  readonly contact: FieldContact | null;
  readonly sourceIds: string[];
}

function emptyChannel(): ChannelResult {
  return { value: 0, gradient: ZERO_VEC3, contact: null, sourceIds: [] };
}

/** Code-unit comparison; locale collation would not be reproducible. */
export function compareSourceId(a: EffectSource, b: EffectSource): number {
  if (a.id < b.id) {
    return -1;
  }
  return a.id > b.id ? 1 : 0;
}

function prepare(source: EffectSource): PreparedSource {
  return {
    source,
    magnitude: f32(Math.abs(source.strength)),
    inverseRange: f32(1 / source.rangeMeters),
  };
}

/**
 * Saturating, commutative union of one signed channel:
 * `aᵢ = clamp(|sᵢ| × smootherstep(1 - dᵢ/rᵢ), 0, 1)` and `1 - Π(1 - aᵢ)`.
 *
 * `prepared` arrives in stable source-ID order, which is what makes the float32
 * accumulation independent of declaration order.
 */
function accumulateChannel(prepared: readonly PreparedSource[], point: Vec3): ChannelResult {
  if (prepared.length === 0) {
    return emptyChannel();
  }

  const evaluated: EvaluatedSource[] = [];
  let forwardProduct = 1;

  for (const entry of prepared) {
    const probe = probeGeometry(entry.source.geometry, point);
    const normalizedDistance = f32(probe.distanceMeters * entry.inverseRange);
    const falloffInput = clamp01(f32(1 - normalizedDistance));
    const contribution = clamp01(f32(entry.magnitude * smootherstep(falloffInput)));

    evaluated.push({
      entry,
      probe,
      contribution,
      // ∂aᵢ/∂dᵢ = |sᵢ| × w'(uᵢ) × (-1 / rᵢ)
      distanceDerivative: f32(
        f32(entry.magnitude * smootherstepDerivative(falloffInput)) * -entry.inverseRange,
      ),
      complementBefore: forwardProduct,
      complementAfter: 1,
    });
    forwardProduct = f32(forwardProduct * f32(1 - contribution));
  }

  let reverseProduct = 1;
  for (let index = evaluated.length - 1; index >= 0; index -= 1) {
    const record = evaluated[index] as EvaluatedSource;
    record.complementAfter = reverseProduct;
    reverseProduct = f32(reverseProduct * f32(1 - record.contribution));
  }

  let gradientX = 0;
  let gradientY = 0;
  let gradientZ = 0;
  let bestContribution = 0;
  let contact: FieldContact | null = null;
  const sourceIds: string[] = [];

  for (const record of evaluated) {
    if (record.contribution > 0) {
      sourceIds.push(record.entry.source.id);
      // Strict comparison in stable ID order means the lowest ID wins a tie.
      if (record.contribution > bestContribution) {
        bestContribution = record.contribution;
        contact = {
          sourceId: record.entry.source.id,
          point: record.probe.contactPoint,
          normal: record.probe.normal,
          distanceMeters: record.probe.distanceMeters,
          contribution: record.contribution,
        };
      }
    }

    if (record.distanceDerivative === 0) {
      continue;
    }
    // ∂/∂x (1 - Π(1 - aⱼ)) = Π_{j≠i}(1 - aⱼ) × ∂aᵢ/∂dᵢ × ∇dᵢ
    const weight = f32(
      f32(record.complementBefore * record.complementAfter) * record.distanceDerivative,
    );
    gradientX = f32(gradientX + f32(weight * record.probe.normal.x));
    gradientY = f32(gradientY + f32(weight * record.probe.normal.y));
    gradientZ = f32(gradientZ + f32(weight * record.probe.normal.z));
  }

  return {
    value: clamp01(f32(1 - forwardProduct)),
    gradient: vec3(gradientX, gradientY, gradientZ),
    contact,
    sourceIds,
  };
}

/**
 * Builds the renderer-independent signed effect field described in
 * `docs/ENVIRONMENT-CONTRACT.md`. Food and kill aggregate independently and are
 * only combined into the contextual `netEffect`; they never cancel each other.
 *
 * Throws {@link import('./validation').FieldValidationError} when a declaration
 * is invalid.
 */
export function createSignedEffectField(sources: readonly EffectSource[]): SignedEffectField {
  assertValidEffectSources(sources);

  const ordered = [...sources].sort(compareSourceId);
  const positive = ordered.filter((source) => source.strength > 0).map(prepare);
  const negative = ordered.filter((source) => source.strength < 0).map(prepare);

  return {
    sources: Object.freeze(ordered),
    sample(point: Vec3): SignedFieldSample {
      const quantized = quantize(point);
      const food = accumulateChannel(positive, quantized);
      const kill = accumulateChannel(negative, quantized);

      const gradient = vec3(
        food.gradient.x - kill.gradient.x,
        food.gradient.y - kill.gradient.y,
        food.gradient.z - kill.gradient.z,
      );
      const gradientMagnitude = length(gradient);

      return {
        food: food.value,
        kill: kill.value,
        netEffect: clamp(f32(food.value - kill.value), -1, 1),
        gradient,
        gradientDirection: gradientMagnitude === 0 ? ZERO_VEC3 : normalize(gradient, ZERO_VEC3),
        gradientMagnitude,
        foodSourceIds: food.sourceIds,
        killSourceIds: kill.sourceIds,
        contributingSourceIds: [...food.sourceIds, ...kill.sourceIds].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
        foodContact: food.contact,
        killContact: kill.contact,
      };
    },
  };
}
