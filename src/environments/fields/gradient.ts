import { f32, vec3 } from './math';
import type { Vec3 } from './math';
import type { SignedEffectField } from './types';

/** Contract-mandated fallback sampling step: 1 cm. */
export const CENTRAL_DIFFERENCE_STEP_METERS = 0.01;

/**
 * Central-difference gradient of `netEffect`, used to cross-check the analytic
 * gradient and to serve any future geometry whose distance field has no
 * practical closed-form derivative.
 */
export function centralDifferenceEffectGradient(
  field: SignedEffectField,
  point: Vec3,
  stepMeters: number = CENTRAL_DIFFERENCE_STEP_METERS,
): Vec3 {
  const step = f32(stepMeters);
  const inverse = f32(1 / f32(2 * step));

  const axisDelta = (axis: 'x' | 'y' | 'z'): number => {
    const forward = field.sample(
      vec3(
        axis === 'x' ? point.x + step : point.x,
        axis === 'y' ? point.y + step : point.y,
        axis === 'z' ? point.z + step : point.z,
      ),
    ).netEffect;
    const backward = field.sample(
      vec3(
        axis === 'x' ? point.x - step : point.x,
        axis === 'y' ? point.y - step : point.y,
        axis === 'z' ? point.z - step : point.z,
      ),
    ).netEffect;
    return f32(f32(forward - backward) * inverse);
  };

  return vec3(axisDelta('x'), axisDelta('y'), axisDelta('z'));
}
