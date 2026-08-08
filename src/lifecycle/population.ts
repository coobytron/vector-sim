import { SeededRandom } from '../simulation/prng';
import { LifecycleValidationError } from './types';
import type { Vec3 } from '../environments/fields';

export interface SpawnCandidate {
  readonly id: string;
  readonly position: Vec3;
  /** Authored preference; higher wins. Defaults to 0. */
  readonly score?: number;
}

export interface SpawnSelectionOptions {
  /** How many candidates may be admitted. */
  readonly capacity: number;
  /**
   * When set, candidates with equal scores are ordered by a seeded shuffle key
   * instead of by ID. The result is still fully reproducible.
   */
  readonly seed?: number;
}

/**
 * Deterministic spawn selection.
 *
 * Ordering is score descending, then either a seeded key or ID ascending. It
 * depends on nothing from the NCA checkpoint, so it can be used before any
 * model is loaded.
 */
export function selectSpawnCandidates(
  candidates: readonly SpawnCandidate[],
  options: SpawnSelectionOptions,
): readonly SpawnCandidate[] {
  const { capacity } = options;
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new LifecycleValidationError(`spawn capacity must be a non-negative integer (got ${capacity})`);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id) {
      throw new LifecycleValidationError('spawn candidate requires a non-empty id');
    }
    if (seen.has(candidate.id)) {
      throw new LifecycleValidationError(`duplicate spawn candidate id ${candidate.id}`);
    }
    seen.add(candidate.id);
  }

  // Sorting by ID first makes the seeded keys themselves order-independent.
  const ordered = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const keys = new Map<string, number>();
  if (options.seed !== undefined) {
    const random = new SeededRandom(options.seed);
    for (const candidate of ordered) {
      keys.set(candidate.id, random.next());
    }
  }

  return ordered
    .sort((a, b) => {
      const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      if (options.seed !== undefined) {
        const keyDelta = (keys.get(a.id) as number) - (keys.get(b.id) as number);
        if (keyDelta !== 0) {
          return keyDelta;
        }
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, capacity);
}

/**
 * Remaining headroom under a population cap. Separate from the lifecycle system
 * so a caller can plan a spawn wave before committing to it.
 */
export function remainingCapacity(livingCount: number, maxPopulation: number): number {
  return Math.max(0, maxPopulation - livingCount);
}
