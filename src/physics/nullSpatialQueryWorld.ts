import type { RayQuery, SpatialObservation, SpatialQueryWorld, SphereQuery } from './types';

const EMPTY: readonly SpatialObservation[] = Object.freeze([]);

export class NullSpatialQueryWorld implements SpatialQueryWorld {
  readonly kind = 'null' as const;
  readonly ready = true;

  raycast(_query: RayQuery): readonly SpatialObservation[] {
    return EMPTY;
  }

  overlapSphere(_query: SphereQuery): readonly SpatialObservation[] {
    return EMPTY;
  }

  step(_dt: number): void {}

  dispose(): void {}
}
