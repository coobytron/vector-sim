import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  GHOST_HOME_LINE_OPACITY,
  GHOST_HOME_SURFACE_OPACITY,
  applyHomeEnvironmentLook,
  createHomeEnvironment,
} from '../src/environments/home';
import { HOME_PRESETS } from '../src/environments/homePresets';
import {
  createHomeGeometryParts,
  homeGeometrySignature,
  selectHomeGeometryParts,
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

  it('consumes manifest quality density while preserving semantic geometry', () => {
    for (const id of supportedHomeGeometryPresets()) {
      const preset = HOME_PRESETS[id];
      const desktop = selectHomeGeometryParts(preset, 'desktop');
      const mobile = selectHomeGeometryParts(preset, 'mobile');

      expect(mobile.length).toBeLessThan(desktop.length);
      expect(homeGeometrySignature(selectHomeGeometryParts(preset, 'mobile'))).toBe(
        homeGeometrySignature(mobile),
      );

      const mobileIds = new Set(mobile.map((part) => part.id));
      for (const part of desktop) {
        if (part.fieldSourceId) expect(mobileIds.has(part.id)).toBe(true);
        if (['floor', 'wall', 'perimeter', 'threshold'].includes(part.role)) {
          expect(mobileIds.has(part.id)).toBe(true);
        }
      }

      const requiredIds = new Set(
        desktop
          .filter(
            (part) =>
              Boolean(part.fieldSourceId) ||
              ['floor', 'wall', 'perimeter', 'threshold'].includes(part.role),
          )
          .map((part) => part.id),
      );
      const mobileOptionalCount = mobile.filter((part) => !requiredIds.has(part.id)).length;
      expect(mobileOptionalCount).toBeLessThanOrEqual(
        preset.qualityDensity.mobile.decorativeBudget,
      );

      const mobileGroup = createHomeEnvironment(preset, 'mobile');
      expect(mobileGroup.children.length).toBe(mobile.length);
      expect(mobileGroup.userData.quality).toBe('mobile');
      expect(mobileGroup.userData.architectureDetail).toBe(
        preset.qualityDensity.mobile.architectureDetail,
      );
    }
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

  it('instantiates the selected manifest as a named Three.js group', () => {
    const preset = HOME_PRESETS['domestic-section'];
    const group = createHomeEnvironment(preset);
    expect(group.name).toBe('home-domestic-section');
    expect(group.userData.presetId).toBe('domestic-section');
    expect(group.userData.seed).toBe(preset.seed);
    expect(group.children.length).toBe(createHomeGeometryParts(preset).length);
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
  it('applies and reverses the Ghost Volume architecture opacity contract', () => {
    const group = createHomeEnvironment(HOME_PRESETS['courtyard-house']);
    applyHomeEnvironmentLook(group, 'ghost');

    const mesh = group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh | undefined;
    const line = group.children.find(
      (child) => child instanceof THREE.Line || child instanceof THREE.LineSegments,
    ) as THREE.Line | THREE.LineSegments | undefined;
    expect(mesh).toBeDefined();
    expect(line).toBeDefined();
    if (!mesh || !line) throw new Error('Home fixture lacks mesh/line geometry');

    const meshMaterial = mesh.material as THREE.MeshStandardMaterial;
    const lineMaterial = line.material as THREE.LineBasicMaterial;
    expect(meshMaterial.transparent).toBe(true);
    expect(meshMaterial.opacity).toBe(GHOST_HOME_SURFACE_OPACITY);
    expect(meshMaterial.depthWrite).toBe(false);
    expect(lineMaterial.opacity).toBe(GHOST_HOME_LINE_OPACITY);
    expect(lineMaterial.depthWrite).toBe(false);

    applyHomeEnvironmentLook(group, 'porcelain');
    expect(meshMaterial.transparent).toBe(false);
    expect(meshMaterial.opacity).toBe(1);
    expect(meshMaterial.depthWrite).toBe(true);
    expect(lineMaterial.opacity).toBe(0.45);
    expect(lineMaterial.depthWrite).toBe(true);
  });
});
