import type { EnvironmentManifest } from '../../fields/types';
import { FOREST_MANIFEST } from './forest';
import { HOME_MANIFEST } from './home';
import { POND_MANIFEST } from './pond';

export type EnvironmentId = 'spectral-home' | 'vector-canopy' | 'prismatic-pond';

/**
 * The registry is the only place an environment is named. Runtime systems pick
 * a manifest by ID and then speak to the field API, so there is no Home,
 * Forest, or Pond branch anywhere in the simulation.
 */
export const ENVIRONMENT_MANIFESTS: Record<EnvironmentId, EnvironmentManifest> = {
  'spectral-home': HOME_MANIFEST,
  'vector-canopy': FOREST_MANIFEST,
  'prismatic-pond': POND_MANIFEST,
};

export function selectEnvironmentManifest(requested: string | null | undefined): EnvironmentManifest {
  if (requested && requested in ENVIRONMENT_MANIFESTS) {
    return ENVIRONMENT_MANIFESTS[requested as EnvironmentId];
  }
  return HOME_MANIFEST;
}

export { FOREST_MANIFEST, HOME_MANIFEST, POND_MANIFEST };
