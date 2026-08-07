import type { EnvironmentManifest } from '../fields/types';

export type QualityTierName = 'mobile' | 'desktop';

export interface QualityTier {
  name: QualityTierName;
  organisms: number;
  slotsPerOrganism: number;
  maxDpr: number;
  longEdgeCap: number;
  targetFps: number;
  targetFrameMs: number;
}

export const QUALITY_TIERS: Record<QualityTierName, QualityTier> = {
  mobile: {
    name: 'mobile',
    organisms: 4,
    slotsPerOrganism: 128,
    maxDpr: 1.25,
    longEdgeCap: 1280,
    targetFps: 30,
    targetFrameMs: 1000 / 30,
  },
  desktop: {
    name: 'desktop',
    organisms: 8,
    slotsPerOrganism: 256,
    maxDpr: 1.5,
    longEdgeCap: 1920,
    targetFps: 60,
    targetFrameMs: 1000 / 60,
  },
};

export interface SimulationConfig {
  tier: QualityTier;
  seed: number;
  hiddenChannels?: number;
  learnedWidth?: number;
  /** Environment manifest to sample fields from; defaults to Home. */
  manifest?: EnvironmentManifest;
}

export interface SimulationSnapshot {
  tick: number;
  active: Uint8Array;
  positions: Float32Array;
  previousPositions: Float32Array;
  velocities: Float32Array;
  energy: Float32Array;
  health: Float32Array;
  edges: Uint32Array;
}

export interface FrameAdvance {
  alpha: number;
  droppedSeconds: number;
  steps: number;
}

