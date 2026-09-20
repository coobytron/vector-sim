import { describe, expect, it } from 'vitest';
import {
  HOME_PRESETS,
  createHomePresetFieldProvider,
  selectHomePreset,
  withHomeEffectStrength,
} from '../src/environments/homePresets';

describe('Spectral Homestead preset manifests', () => {
  it('defines the three deterministic Home presets with four authored camera roles', () => {
    expect(Object.keys(HOME_PRESETS)).toEqual([
      'courtyard-house',
      'domestic-section',
      'tabletop-habitat',
    ]);

    for (const preset of Object.values(HOME_PRESETS)) {
      expect(preset.schemaVersion).toBe('home-preset.v1');
      expect(preset.seed).toBeGreaterThan(0);
      expect(preset.spawnRegions.length).toBeGreaterThan(0);
      expect(preset.shelterRegions.length).toBeGreaterThan(0);
      expect(new Set(preset.cameras.map((camera) => camera.role))).toEqual(
        new Set(['establishing', 'orbit', 'top-down', 'macro']),
      );
      expect(preset.qualityDensity.mobile.architectureDetail).toBeLessThan(
        preset.qualityDensity.desktop.architectureDetail,
      );
      expect(preset.qualityDensity.mobile.decorativeBudget).toBeLessThan(
        preset.qualityDensity.desktop.decorativeBudget,
      );
    }
  });

  it('falls back to Courtyard House for unknown preset IDs', () => {
    expect(selectHomePreset('unknown').id).toBe('courtyard-house');
    expect(selectHomePreset(null).id).toBe('courtyard-house');
  });

  it('switches one authored source from food to danger through manifest data only', () => {
    const preset = HOME_PRESETS['courtyard-house'];
    const source = preset.effectSources.find(
      (candidate) => candidate.id === preset.switchableEffectSourceId,
    );
    expect(source).toBeDefined();
    if (!source || source.geometry.kind !== 'sphere') throw new Error('fixture source must be a sphere');

    const positive = createHomePresetFieldProvider(preset).sample(source.geometry.center);
    expect(positive.scalars.energy).toBeGreaterThan(0);
    expect(positive.scalars.danger).toBe(0);

    const flipped = withHomeEffectStrength(preset, preset.switchableEffectSourceId, -0.42);
    const negative = createHomePresetFieldProvider(flipped).sample(source.geometry.center);
    expect(negative.scalars.energy).toBe(0);
    expect(negative.scalars.danger).toBeGreaterThan(0);
  });

  it('rejects invalid strength edits and unknown source IDs', () => {
    const preset = HOME_PRESETS['tabletop-habitat'];
    expect(() => withHomeEffectStrength(preset, preset.switchableEffectSourceId, 1.1)).toThrow(
      RangeError,
    );
    expect(() => withHomeEffectStrength(preset, 'missing-source', 0.2)).toThrow(
      /Unknown Home effect source/,
    );
  });
});
