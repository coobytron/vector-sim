import type { Vec3 } from '../environments/fields';
import type { FieldContact } from '../environments/fields';

/**
 * Lifecycle status, in the fixed priority order the resolver evaluates.
 *
 * These are metabolic states, not visual states. Nothing here selects geometry,
 * emission, or colour — the renderer reads them in a later slice.
 */
export type LifecycleStatus =
  | 'dead'
  | 'dying'
  | 'stressed'
  | 'repairing'
  | 'thriving'
  | 'resting'
  | 'searching';

export const LIFECYCLE_STATUS_PRIORITY: readonly LifecycleStatus[] = [
  'dead',
  'dying',
  'stressed',
  'repairing',
  'thriving',
  'resting',
  'searching',
];

export type DeathCause = 'damage' | 'starvation';

/** What the organism read from the shared provider on the current tick. */
export interface LifecycleFieldSample {
  /** Generic positive channel, `[0, 1]`. */
  readonly energy: number;
  /** Generic negative channel, `[0, 1]`. */
  readonly danger: number;
  /** Contributing source IDs, ascending. */
  readonly sourceIds: readonly string[];
  readonly contacts: readonly FieldContact[];
}

export interface OrganismLifecycleState {
  readonly id: string;
  readonly seed: number;
  readonly phenotype: string;
  readonly generation: number;
  readonly position: Vec3;
  readonly ageSeconds: number;
  /** Metabolic resource, `[0, 1]`. */
  readonly energy: number;
  /** Energy gained per second on the last tick. */
  readonly intakeRate: number;
  /** Energy spent per second on the last tick. */
  readonly expenditureRate: number;
  /** Accumulated structural damage, `[0, 1]`. */
  readonly damage: number;
  /** Derived: `1 - damage`. Damage is the single source of truth. */
  readonly viability: number;
  readonly status: LifecycleStatus;
  /** Tick at which the organism entered `status`. */
  readonly statusSinceTick: number;
  /** Seconds spent at zero energy; drives the starvation threshold. */
  readonly starvedSeconds: number;
  readonly sample: LifecycleFieldSample;
  readonly deathCause: DeathCause | null;
}

interface LifecycleEventBase {
  readonly tick: number;
  readonly timeSeconds: number;
  readonly organismId: string;
  /** Field sources implicated in this event, ascending. Empty when not causal. */
  readonly sourceIds: readonly string[];
  readonly contacts: readonly FieldContact[];
}

export type LifecycleEvent =
  | (LifecycleEventBase & { readonly kind: 'spawn'; readonly phenotype: string; readonly generation: number })
  | (LifecycleEventBase & { readonly kind: 'intake'; readonly amount: number; readonly channelValue: number })
  | (LifecycleEventBase & { readonly kind: 'damage'; readonly amount: number; readonly channelValue: number })
  | (LifecycleEventBase & { readonly kind: 'lesion'; readonly amount: number; readonly reason: string })
  | (LifecycleEventBase & { readonly kind: 'repair-request'; readonly requested: number; readonly granted: boolean; readonly blockedBy: readonly string[] })
  | (LifecycleEventBase & { readonly kind: 'repair'; readonly amount: number })
  | (LifecycleEventBase & {
      readonly kind: 'transition';
      readonly from: LifecycleStatus;
      readonly to: LifecycleStatus;
    })
  | (LifecycleEventBase & { readonly kind: 'death'; readonly cause: DeathCause })
  | (LifecycleEventBase & { readonly kind: 'respawn'; readonly generation: number });

export type LifecycleEventKind = LifecycleEvent['kind'];

/** `Omit` over a union collapses to its shared keys, so distribute it. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An event as authored at a call site: the payload plus optional causal
 * context. The system fills in tick, time, and organism identity.
 */
export type LifecycleEventDraft = DistributiveOmit<
  LifecycleEvent,
  'tick' | 'timeSeconds' | 'organismId' | 'sourceIds' | 'contacts'
> & {
  readonly sourceIds?: readonly string[];
  readonly contacts?: readonly FieldContact[];
};

/**
 * Data-driven rate table. Defaults come from the metabolism section of
 * `docs/SIMULATION-CONTRACT.md`; every field is validated before use.
 */
export interface LifecycleRates {
  /** Energy gained per second at channel `energy = 1`. */
  readonly intakePerEnergyUnit: number;
  /** Baseline energy spent per second. */
  readonly idleDrainPerSecond: number;
  /** Damage taken per second at channel `danger = 1`. */
  readonly damagePerDangerUnit: number;
  /** Damage repaired per second when repair is permitted. */
  readonly repairPerSecond: number;
  /** Repair requires energy strictly above this. */
  readonly repairEnergyThreshold: number;
  /** Repair requires danger strictly below this. */
  readonly repairDangerCeiling: number;
  /** Danger at or above this marks the organism stressed. */
  readonly stressedDanger: number;
  /** Viability below this marks the organism dying. */
  readonly dyingViability: number;
  /** Energy at or above this marks the organism thriving. */
  readonly thrivingEnergy: number;
  /** Energy at or above this marks the organism resting. */
  readonly restingEnergy: number;
  /**
   * Seconds at zero energy before starvation death, or `null` to disable it.
   *
   * Disabled by default, because `docs/SIMULATION-CONTRACT.md` has no
   * starvation rule: zero energy only blocks birth and repair, and death comes
   * from viability ("all core cells inactive, or mean core health remains zero
   * for 30 ticks"). Starvation is therefore an optional authored policy rather
   * than a contract behaviour, and inventing a default number would have
   * quietly added a death mode the contract does not describe.
   */
  readonly starvationSeconds: number | null;
  /** Hard cap on simultaneously live organisms. */
  readonly maxPopulation: number;
}

export const DEFAULT_LIFECYCLE_RATES: LifecycleRates = {
  intakePerEnergyUnit: 0.2,
  idleDrainPerSecond: 0.012,
  damagePerDangerUnit: 0.35,
  repairPerSecond: 0.08,
  repairEnergyThreshold: 0.35,
  repairDangerCeiling: 0.05,
  stressedDanger: 0.05,
  dyingViability: 0.2,
  thrivingEnergy: 0.7,
  restingEnergy: 0.45,
  starvationSeconds: null,
  maxPopulation: 8,
};

export class LifecycleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleValidationError';
  }
}
