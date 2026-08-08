/**
 * Deterministic lifecycle core (P08a).
 *
 * Turns shared `FieldProvider` samples into energy, damage, viability, status,
 * and a causal event log. Renderer-independent and environment-independent:
 * Home, Forest, and Pond differ only by which provider they hand in. Visual
 * decode, emission, and trained-NCA coupling stay in later slices.
 */
export { LIFECYCLE_TICK_SECONDS, createLifecycleSystem } from './lifecycle';
export type { LifecycleSystem, LifecycleSystemOptions, SpawnRequest } from './lifecycle';
export { remainingCapacity, selectSpawnCandidates } from './population';
export type { SpawnCandidate, SpawnSelectionOptions } from './population';
export { resolveLifecycleRates } from './rates';
export {
  DEFAULT_LIFECYCLE_RATES,
  LIFECYCLE_STATUS_PRIORITY,
  LifecycleValidationError,
} from './types';
export type {
  DeathCause,
  LifecycleEvent,
  LifecycleEventKind,
  LifecycleFieldSample,
  LifecycleRates,
  LifecycleStatus,
  OrganismLifecycleState,
} from './types';
