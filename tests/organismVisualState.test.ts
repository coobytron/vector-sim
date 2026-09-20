import { describe, expect, it } from 'vitest';
import { NODE_ROLE, type OrganismVisualState, type VisualDecodeInput } from '../src/organisms/types';
import { createDecodedCellVisual, decodeCellVisual } from '../src/organisms/visualState';
import { DEATH_WAVELENGTH_NM, LIFE_WAVELENGTH_NM } from '../src/spectral/color';

const base: VisualDecodeInput = {
  energy: 0.55,
  health: 1,
  previousHealth: 1,
  activity: 0.5,
  thicknessSignal: 0,
  curvatureSignal: 0,
  connectivitySignal: 0,
  role: NODE_ROLE.structure,
  phase: 0.5,
};

function decode(overrides: Partial<VisualDecodeInput>) {
  return decodeCellVisual({ ...base, ...overrides }, createDecodedCellVisual());
}

describe('organism visual state decoder', () => {
  it('keeps life blue and reserves endpoint red for death', () => {
    const feeding = decode({ stateOverride: 'feeding' });
    const damage = decode({ stateOverride: 'damaged' });
    const death = decode({ stateOverride: 'death' });
    const regeneration = decode({ stateOverride: 'regenerating' });
    expect(feeding.wavelengthNm).toBeGreaterThanOrEqual(LIFE_WAVELENGTH_NM);
    expect(feeding.wavelengthNm).toBeLessThan(500);
    expect(regeneration.wavelengthNm).toBeLessThan(500);
    expect(damage.wavelengthNm).toBeLessThan(DEATH_WAVELENGTH_NM);
    expect(death.wavelengthNm).toBe(DEATH_WAVELENGTH_NM);
  });

  it('communicates damage and death through form and connectivity as well as color', () => {
    const dormant = decode({ stateOverride: 'dormant' });
    const damaged = decode({ stateOverride: 'damaged' });
    const dying = decode({ stateOverride: 'dying' });
    const death = decode({ stateOverride: 'death' });
    expect(damaged.connectivity).toBeLessThan(dormant.connectivity);
    expect(dying.connectivity).toBeLessThan(damaged.connectivity);
    expect(death.connectivity).toBeLessThan(dying.connectivity);
    expect(death.thickness).toBeLessThan(dormant.thickness);
  });

  it('decodes every required state without invalid geometry values', () => {
    const states: OrganismVisualState[] = [
      'dormant',
      'feeding',
      'starving',
      'damaged',
      'mutating',
      'dying',
      'death',
      'regenerating',
    ];
    for (const state of states) {
      const sample = decode({ stateOverride: state });
      expect(Object.values(sample).filter((value) => typeof value === 'number').every(Number.isFinite)).toBe(true);
    }
  });

  it('detects regeneration from rising health without a renderer-owned state', () => {
    const regeneration = decode({ health: 0.8, previousHealth: 0.7 });
    expect(regeneration.state).toBe('regenerating');
    expect(regeneration.emissionStrength).toBeGreaterThan(0);
  });

  it('reads rising health as repair while the cell is still inside the damaged band', () => {
    // Regression: `health < 0.72` used to be tested before rising health, so a
    // cell healing from 0.3 upward stayed coral damage and the repair cue was
    // unreachable exactly where repair is most legible.
    for (const health of [0.25, 0.4, 0.55, 0.71]) {
      const healing = decode({ health, previousHealth: health - 0.05 });
      expect(healing.state).toBe('regenerating');
      expect(healing.wavelengthNm).toBeLessThan(500);
    }
  });

  it('keeps dying and death terminal even while health ticks upward', () => {
    expect(decode({ health: 0.19, previousHealth: 0.1 }).state).toBe('dying');
    expect(decode({ health: 0.01, previousHealth: 0 }).state).toBe('death');
  });

  it('still reads a falling cell inside the damaged band as damage', () => {
    const hurt = decode({ health: 0.5, previousHealth: 0.6 });
    expect(hurt.state).toBe('damaged');
  });
});
