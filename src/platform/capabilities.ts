import { QUALITY_TIERS, type QualityTier, type QualityTierName } from '../simulation/types';

export interface RuntimeCapabilities {
  webgl2: boolean;
  webgpu: boolean;
  coarsePointer: boolean;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
}

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  gpu?: unknown;
}

export function detectCapabilities(): RuntimeCapabilities {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
  });
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  const hintedNavigator = navigator as NavigatorWithHints;

  return {
    webgl2: context !== null,
    webgpu: hintedNavigator.gpu !== undefined,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    deviceMemoryGb: hintedNavigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

export function selectQualityTier(
  capabilities: RuntimeCapabilities,
  requested?: string | null,
): QualityTier {
  if (requested === 'mobile' || requested === 'desktop') {
    return QUALITY_TIERS[requested];
  }

  const memoryConstrained = capabilities.deviceMemoryGb !== undefined && capabilities.deviceMemoryGb <= 4;
  const coreConstrained =
    capabilities.hardwareConcurrency !== undefined && capabilities.hardwareConcurrency <= 4;
  const selected: QualityTierName =
    capabilities.coarsePointer || memoryConstrained || coreConstrained ? 'mobile' : 'desktop';
  return QUALITY_TIERS[selected];
}

export function effectivePixelRatio(
  width: number,
  height: number,
  devicePixelRatio: number,
  tier: QualityTier,
): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const longEdge = Math.max(safeWidth, safeHeight);
  const resolutionScale = Math.min(1, tier.longEdgeCap / longEdge);
  return Math.max(0.5, Math.min(devicePixelRatio, tier.maxDpr) * resolutionScale);
}

