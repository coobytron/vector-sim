import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_MANIFESTS,
  FOREST_MANIFEST,
  HOME_MANIFEST,
  POND_MANIFEST,
  selectEnvironmentManifest,
} from '../src/environments/manifests';
import {
  EnvironmentManifestError,
  loadEnvironment,
  validateEnvironmentManifest,
} from '../src/fields/manifest';
import { createFieldSample, type EnvironmentManifest } from '../src/fields/types';

const DIGEST = 'a'.repeat(64);

function baseManifest(overrides: Partial<EnvironmentManifest> = {}): EnvironmentManifest {
  return {
    schemaVersion: 'environment.v1',
    id: 'fixture',
    displayName: 'Fixture',
    units: 'meters',
    coordinateSystem: 'right-handed-y-up',
    bounds: { min: [-4, -4, -4], max: [4, 4, 4] },
    assets: [{ id: 'shell', uri: 'shell.glb', sha256: DIGEST }],
    sources: [
      {
        id: 'feed',
        geometry: { kind: 'point', position: [0, 0, 0] },
        channels: { effect: { strength: 0.5, rangeMeters: 0.5 } },
      },
    ],
    spawnRegions: [
      {
        id: 'spawn',
        volume: { kind: 'box', center: [0, 3, 0], halfExtents: [0.4, 0.4, 0.4] },
        capacity: 4,
      },
    ],
    cameraPresets: [
      {
        id: 'hero',
        target: [0, 0, 0],
        position: [3, 3, 3],
        verticalFovDegrees: 42,
        nearMeters: 0.05,
        farMeters: 40,
        safeBounds: { min: [-4, -4, -4], max: [4, 4, 4] },
        fallbackInput: 'pointer',
      },
    ],
    looks: ['porcelain-spectrum', 'technical-wire', 'ghost-volume'],
    qualityTiers: ['mobile', 'desktop'],
    ...overrides,
  };
}

function errorsFor(overrides: Partial<EnvironmentManifest>, options = {}): string[] {
  return [...validateEnvironmentManifest(baseManifest(overrides), options).errors];
}

describe('environment manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateEnvironmentManifest(baseManifest())).toEqual({ ok: true, errors: [] });
  });

  it('rejects an unsupported schema version without cascading', () => {
    const result = validateEnvironmentManifest(baseManifest({ schemaVersion: 'environment.v2' }));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unsupported manifest version');
  });

  it('rejects duplicate stable IDs across every collection', () => {
    const errors = errorsFor({
      sources: [
        {
          id: 'shared',
          geometry: { kind: 'point', position: [0, 0, 0] },
          channels: { effect: { strength: 0.2, rangeMeters: 0.3 } },
        },
      ],
      spawnRegions: [
        {
          id: 'shared',
          volume: { kind: 'box', center: [0, 3, 0], halfExtents: [0.4, 0.4, 0.4] },
          capacity: 2,
        },
      ],
    });
    expect(errors.some((error) => error.includes('Duplicate stable ID: shared'))).toBe(true);
  });

  it('rejects out-of-range channel values', () => {
    expect(
      errorsFor({
        sources: [
          {
            id: 'too-strong',
            geometry: { kind: 'point', position: [0, 0, 0] },
            channels: { effect: { strength: 1.4, rangeMeters: 0.4 } },
          },
        ],
      }).some((error) => error.includes('outside [-1, 1]')),
    ).toBe(true);

    expect(
      errorsFor({
        sources: [
          {
            id: 'bad-shelter',
            geometry: { kind: 'point', position: [0, 0, 0] },
            channels: { shelter: 1.5 },
          },
        ],
      }).some((error) => error.includes('shelter')),
    ).toBe(true);

    expect(
      errorsFor({
        sources: [
          {
            id: 'bad-habitat',
            geometry: { kind: 'point', position: [0, 0, 0] },
            channels: { habitat: [0.5, -0.2, 0.1] },
          },
        ],
      }).some((error) => error.includes('habitat channel 1')),
    ).toBe(true);
  });

  it('rejects an effect source with a non-positive range', () => {
    const errors = errorsFor({
      sources: [
        {
          id: 'no-range',
          geometry: { kind: 'point', position: [0, 0, 0] },
          channels: { effect: { strength: 0.5, rangeMeters: 0 } },
        },
      ],
    });
    expect(errors.some((error) => error.includes('range must be greater than zero'))).toBe(true);
  });

  it('rejects a missing or mismatched asset checksum', () => {
    expect(
      errorsFor({ assets: [{ id: 'shell', uri: 'shell.glb', sha256: '' }] }).some((error) =>
        error.includes('valid sha256 checksum'),
      ),
    ).toBe(true);

    expect(
      errorsFor({}, { assetChecksums: { shell: 'b'.repeat(64) } }).some((error) =>
        error.includes('does not match the known digest'),
      ),
    ).toBe(true);

    expect(validateEnvironmentManifest(baseManifest(), { assetChecksums: { shell: DIGEST } }).ok).toBe(
      true,
    );
  });

  it('rejects a spawn region that overlaps kill exposure', () => {
    const errors = errorsFor({
      sources: [
        {
          id: 'hazard',
          geometry: { kind: 'point', position: [0, 3, 0] },
          channels: { effect: { strength: -1, rangeMeters: 1.5 } },
        },
      ],
    });
    expect(errors.some((error) => error.includes('overlaps kill exposure'))).toBe(true);
  });

  it('rejects a spawn region without obstacle clearance', () => {
    const errors = errorsFor({
      sources: [
        {
          id: 'pillar',
          geometry: { kind: 'box', center: [0, 3, 0], halfExtents: [0.2, 0.2, 0.2] },
          channels: { obstacle: true },
        },
      ],
    });
    expect(errors.some((error) => error.includes('obstacle penetration'))).toBe(true);
  });

  it('rejects a camera preset without safe bounds or a fallback input', () => {
    const errors = errorsFor({
      cameraPresets: [
        {
          id: 'hero',
          target: [0, 0, 0],
          position: [3, 3, 3],
          verticalFovDegrees: 42,
          nearMeters: 0.05,
          farMeters: 40,
          safeBounds: undefined as never,
          fallbackInput: 'gyro' as never,
        },
      ],
    });
    expect(errors.some((error) => error.includes('safe framing bounds'))).toBe(true);
    expect(errors.some((error) => error.includes('fallback input'))).toBe(true);
  });

  it('rejects a manifest missing a required look', () => {
    const errors = errorsFor({ looks: ['porcelain-spectrum', 'technical-wire'] });
    expect(errors.some((error) => error.includes('ghost-volume'))).toBe(true);
  });

  it('throws a readable error when loading an invalid manifest', () => {
    expect(() => loadEnvironment(baseManifest({ looks: [] }))).toThrow(EnvironmentManifestError);
    try {
      loadEnvironment(baseManifest({ looks: [] }));
    } catch (error) {
      expect((error as EnvironmentManifestError).errors.length).toBeGreaterThan(0);
      expect((error as Error).message).toContain('fixture');
    }
  });
});

describe('shipped environments', () => {
  it('validates Home, Forest, and Pond', () => {
    for (const manifest of Object.values(ENVIRONMENT_MANIFESTS)) {
      expect(validateEnvironmentManifest(manifest)).toEqual({ ok: true, errors: [] });
    }
  });

  it('answers the same query API in every environment', () => {
    const sample = createFieldSample();
    for (const manifest of [HOME_MANIFEST, FOREST_MANIFEST, POND_MANIFEST]) {
      const sampler = loadEnvironment(manifest);
      const food = sampler.sources.find((source) => source.strength > 0);
      const kill = sampler.sources.find((source) => source.strength < 0);
      expect(food).toBeDefined();
      expect(kill).toBeDefined();

      const foodGeometry = food?.geometry;
      const killGeometry = kill?.geometry;
      const foodPoint =
        foodGeometry?.kind === 'sphere'
          ? foodGeometry.center
          : foodGeometry?.kind === 'box'
            ? foodGeometry.center
            : foodGeometry?.kind === 'capsule'
              ? foodGeometry.path[0]
              : [0, 0, 0];
      const killPoint =
        killGeometry?.kind === 'sphere'
          ? killGeometry.center
          : killGeometry?.kind === 'box'
            ? killGeometry.center
            : killGeometry?.kind === 'capsule'
              ? killGeometry.path[0]
              : [0, 0, 0];

      sampler.sample(foodPoint?.[0] ?? 0, foodPoint?.[1] ?? 0, foodPoint?.[2] ?? 0, sample);
      expect(sample.food).toBeGreaterThan(0.5);
      sampler.sample(killPoint?.[0] ?? 0, killPoint?.[1] ?? 0, killPoint?.[2] ?? 0, sample);
      expect(sample.kill).toBeGreaterThan(0.5);

      // Every environment can place its authored spawn.
      const region = sampler.spawnRegionIds[0] as string;
      expect(sampler.placeSpawn(region, 0)).toBeDefined();
    }
  });

  it('reuses the same channels in Forest and Pond with no added channel', () => {
    const pond = loadEnvironment(POND_MANIFEST);
    const sample = createFieldSample();
    pond.sample(0, 0.2, 0, sample);
    expect(Math.hypot(sample.flowX, sample.flowY, sample.flowZ)).toBeGreaterThan(0);
    expect(Math.hypot(sample.flowX, sample.flowY, sample.flowZ)).toBeLessThanOrEqual(1);

    const forest = loadEnvironment(FOREST_MANIFEST);
    forest.sample(0, 3.4, 0, sample);
    expect(sample.habitatB).toBeGreaterThan(0);
  });

  it('selects Home for an unknown environment ID', () => {
    expect(selectEnvironmentManifest('vector-canopy')).toBe(FOREST_MANIFEST);
    expect(selectEnvironmentManifest('nonexistent')).toBe(HOME_MANIFEST);
    expect(selectEnvironmentManifest(null)).toBe(HOME_MANIFEST);
  });
});
