import { describe, expect, it } from 'vitest';
import { effectivePixelRatio, selectQualityTier } from '../src/platform/capabilities';
import { QUALITY_TIERS } from '../src/simulation/types';

describe('quality selection', () => {
  it('honors an explicit quality request', () => {
    const selected = selectQualityTier(
      { webgl2: true, webgpu: false, coarsePointer: true },
      'desktop',
    );
    expect(selected.name).toBe('desktop');
  });

  it('defaults coarse-pointer or constrained devices to mobile', () => {
    expect(
      selectQualityTier({ webgl2: true, webgpu: false, coarsePointer: true }).name,
    ).toBe('mobile');
    expect(
      selectQualityTier({
        webgl2: true,
        webgpu: false,
        coarsePointer: false,
        deviceMemoryGb: 4,
      }).name,
    ).toBe('mobile');
  });

  it('caps DPR and long-edge resolution deterministically', () => {
    expect(effectivePixelRatio(390, 844, 3, QUALITY_TIERS.mobile)).toBe(1.25);
    expect(effectivePixelRatio(1600, 900, 3, QUALITY_TIERS.mobile)).toBe(1);
    expect(effectivePixelRatio(1920, 1080, 2, QUALITY_TIERS.desktop)).toBe(1.5);
  });
});

