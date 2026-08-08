import { DEFAULT_LIFECYCLE_RATES, LifecycleValidationError } from './types';
import type { LifecycleRates } from './types';

interface RateRule {
  readonly minimum: number;
  readonly maximum: number;
}

const RULES: Record<keyof LifecycleRates, RateRule> = {
  intakePerEnergyUnit: { minimum: 0, maximum: 100 },
  idleDrainPerSecond: { minimum: 0, maximum: 100 },
  damagePerDangerUnit: { minimum: 0, maximum: 100 },
  repairPerSecond: { minimum: 0, maximum: 100 },
  repairEnergyThreshold: { minimum: 0, maximum: 1 },
  repairDangerCeiling: { minimum: 0, maximum: 1 },
  stressedDanger: { minimum: 0, maximum: 1 },
  dyingViability: { minimum: 0, maximum: 1 },
  thrivingEnergy: { minimum: 0, maximum: 1 },
  restingEnergy: { minimum: 0, maximum: 1 },
  starvationSeconds: { minimum: 0, maximum: 86_400 },
  maxPopulation: { minimum: 1, maximum: 4096 },
};

/**
 * Validates a rate table and fills unspecified fields from
 * {@link DEFAULT_LIFECYCLE_RATES}. Rates are data, so a bad table has to fail
 * loudly at construction rather than produce a quietly wrong simulation.
 */
export function resolveLifecycleRates(overrides: Partial<LifecycleRates> = {}): LifecycleRates {
  const merged = { ...DEFAULT_LIFECYCLE_RATES, ...overrides };

  for (const key of Object.keys(RULES) as (keyof LifecycleRates)[]) {
    const value = merged[key];
    const rule = RULES[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new LifecycleValidationError(`lifecycle rate ${key} must be a finite number (got ${String(value)})`);
    }
    if (value < rule.minimum || value > rule.maximum) {
      throw new LifecycleValidationError(
        `lifecycle rate ${key} must be within [${rule.minimum}, ${rule.maximum}] (got ${value})`,
      );
    }
  }

  if (!Number.isInteger(merged.maxPopulation)) {
    throw new LifecycleValidationError(
      `lifecycle rate maxPopulation must be an integer (got ${merged.maxPopulation})`,
    );
  }
  if (merged.thrivingEnergy < merged.restingEnergy) {
    throw new LifecycleValidationError(
      `thrivingEnergy (${merged.thrivingEnergy}) must be at least restingEnergy (${merged.restingEnergy})`,
    );
  }

  return Object.freeze(merged);
}
