import type { SpectralLookName } from '../spectral/looks';

/**
 * Persistent topology/debug geometry belongs to Technical Wire only.
 * Porcelain Spectrum and Ghost Volume must stay readable from morphology,
 * ribbons/facets, motion, and causal spectral emission without an always-on
 * graph skeleton.
 */
export function topologyOverlayVisible(look: SpectralLookName): boolean {
  return look === 'technical';
}
