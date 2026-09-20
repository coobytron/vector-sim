import { describe, expect, it } from 'vitest';
import { HOME_PRESETS } from '../src/environments/homePresets';
import {
  createHomeGeometryParts,
  homeGeometrySignature,
  supportedHomeGeometryPresets,
} from '../src/environments/homeGeometry';

describe('Spectral Homestead modular geometry', () => {
  it('builds deterministic, distinct layouts for all three Home presets', () => {
    const signatures = supportedHomeGeometryPresets().map((id) => {
      const first = createHomeGeometryParts(HOME_PRESETS[id]);
      const second = createHomeGeometryParts(HOME_PRESETS[id]);
      expect(homeGeometrySignature(first)).toBe(homeGeometrySignature(second));
      expect(first.length).toBeGreaterThanOrEqual(12);
      expect(new Set(first.map((part) => part.id)).size).toBe(first.length);
      return homeGeometrySignature(first);
    });
    expect(new Set(signatures).size).toBe(3);
  });

  it('covers the modular architecture vocabulary across the Home kit', () => {
    const roles = new Set(
      supportedHomeGeometryPresets().flatMap((id) =>
        createHomeGeometryParts(HOME_PRESETS[id]).map((part) => part.role),
      ),
    );
    for (const role of [
      'floor',
      'wall',
      'aperture',
      'threshold',
      'stair',
      'furniture',
      'perimeter',
      'conduit',
      'utility',
    ]) {
      expect(roles.has(role as never)).toBe(true);
    }
  });

  it('binds positive, negative, and switchable sources to visible Home geometry', () => {
    for (const id of supportedHomeGeometryPresets()) {
      const preset = HOME_PRESETS[id];
      const parts = createHomeGeometryParts(preset);
      const sourceIds = new Set(parts.flatMap((part) => part.fieldSourceId ? [part.fieldSourceId] : []));
      expect(sourceIds.has(preset.switchableEffectSourceId)).toBe(true);
      expect(preset.effectSources.some((source) => source.strength > 0 && sourceIds.has(source.id))).toBe(true);
      expect(preset.effectSources.some((source) => source.strength < 0 && sourceIds.has(source.id))).toBe(true);
    }
  });
});
