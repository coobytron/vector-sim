import { describe, expect, it } from 'vitest';
import {
  GHOST_MEMBRANE_OPACITY,
  GHOST_PRIMARY_OPACITY,
  SPECTRAL_LOOKS,
} from '../src/spectral/looks';

/**
 * The numbers in `docs/ART-DIRECTION.md` are normative, and the renderer and
 * the deterministic capture harness both read them from `looks.ts`. These
 * assertions are the regression guard that kept Ghost Volume from drifting back
 * into additive fog.
 */
describe('spectral look contract', () => {
  it('keeps Ghost Volume primary geometry legible', () => {
    // "primary nodes and active edges remain >= 0.75"
    expect(GHOST_PRIMARY_OPACITY).toBeGreaterThanOrEqual(0.75);
    expect(GHOST_PRIMARY_OPACITY).toBeLessThanOrEqual(1);
  });

  it('keeps Ghost Volume membranes inside the authored translucency band', () => {
    // "organism membranes are 0.12-0.35"
    expect(GHOST_MEMBRANE_OPACITY).toBeGreaterThanOrEqual(0.12);
    expect(GHOST_MEMBRANE_OPACITY).toBeLessThanOrEqual(0.35);
  });

  it('keeps membranes behind primary geometry so topology stays readable', () => {
    expect(GHOST_MEMBRANE_OPACITY).toBeLessThan(GHOST_PRIMARY_OPACITY);
  });

  it('holds Technical Wire bloom at or under half of Porcelain Spectrum', () => {
    expect(SPECTRAL_LOOKS.technical.bloomStrength).toBeLessThanOrEqual(
      SPECTRAL_LOOKS.porcelain.bloomStrength * 0.5,
    );
  });

  it('keeps every look inside a restrained output saturation', () => {
    for (const look of Object.values(SPECTRAL_LOOKS)) {
      expect(look.outputSaturation).toBeGreaterThanOrEqual(0);
      expect(look.outputSaturation).toBeLessThanOrEqual(0.5);
      expect(look.emissionScale).toBeGreaterThan(0);
    }
  });
});
