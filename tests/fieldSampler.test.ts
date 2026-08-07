import { describe, expect, it } from 'vitest';
import { EnvironmentFieldSampler, effectFalloff } from '../src/fields/fieldSampler';
import {
  createFieldSample,
  FIELD_BATCH_STRIDE,
  type EnvironmentManifest,
  type FieldSourceDescriptor,
} from '../src/fields/types';

function manifest(
  sources: FieldSourceDescriptor[],
  overrides: Partial<EnvironmentManifest> = {},
): EnvironmentManifest {
  return {
    schemaVersion: 'environment.v1',
    id: 'test-environment',
    displayName: 'Test Environment',
    units: 'meters',
    coordinateSystem: 'right-handed-y-up',
    bounds: { min: [-8, -8, -8], max: [8, 8, 8] },
    assets: [],
    sources,
    spawnRegions: [
      {
        id: 'test-spawn',
        volume: { kind: 'box', center: [0, 4, 0], halfExtents: [0.5, 0.5, 0.5] },
        capacity: 4,
      },
    ],
    cameraPresets: [
      {
        id: 'test-hero',
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

function foodSource(id: string, x: number, strength = 1, range = 1): FieldSourceDescriptor {
  return {
    id,
    geometry: { kind: 'point', position: [x, 0, 0] },
    channels: { effect: { strength, rangeMeters: range } },
  };
}

const sample = createFieldSample();

describe('signed effect sampling', () => {
  it('reads full authored strength at the surface and nothing past the range', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('a', 0, 0.8, 1)]));

    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBeCloseTo(0.8, 5);
    expect(sample.kill).toBe(0);
    expect(sample.effect).toBeCloseTo(0.8, 5);

    sampler.sample(1, 0, 0, sample);
    expect(sample.food).toBe(0);

    sampler.sample(2, 0, 0, sample);
    expect(sample.food).toBe(0);
  });

  it('falls off with the documented smootherstep curve', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('a', 0, 1, 1)]));
    for (const distance of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      sampler.sample(distance, 0, 0, sample);
      expect(sample.food).toBeCloseTo(effectFalloff(distance, 1), 5);
    }
    // Half range is exactly the midpoint of a symmetric falloff.
    sampler.sample(0.5, 0, 0, sample);
    expect(sample.food).toBeCloseTo(0.5, 5);
  });

  it('combines overlapping same-sign sources with a saturating union', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([foodSource('a', -0.25, 1, 1), foodSource('b', 0.25, 1, 1)]),
    );
    sampler.sample(0, 0, 0, sample);
    const single = effectFalloff(0.25, 1);
    expect(sample.food).toBeCloseTo(1 - (1 - single) * (1 - single), 5);
    expect(sample.food).toBeLessThanOrEqual(1);
  });

  it('keeps food and kill separate so equal exposure never cancels', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([foodSource('feed', 0, 1, 1), foodSource('hazard', 0, -1, 1)]),
    );
    sampler.sample(0.3, 0, 0, sample);
    expect(sample.food).toBeGreaterThan(0);
    expect(sample.kill).toBeGreaterThan(0);
    expect(sample.food).toBeCloseTo(sample.kill, 6);
    expect(sample.effect).toBeCloseTo(0, 6);
  });

  it('produces identical samples regardless of declaration order', () => {
    const sources = [
      foodSource('alpha', -0.4, 0.9, 1.2),
      foodSource('beta', 0.35, -0.7, 0.9),
      {
        id: 'gamma',
        geometry: { kind: 'sphere', center: [0, 0.3, 0], radiusMeters: 0.2 },
        channels: { effect: { strength: 0.5, rangeMeters: 0.8 }, obstacle: true },
      } satisfies FieldSourceDescriptor,
    ];
    const forward = new EnvironmentFieldSampler(manifest(sources));
    const reversed = new EnvironmentFieldSampler(manifest([...sources].reverse()));
    const shuffled = new EnvironmentFieldSampler(
      manifest([sources[1] as FieldSourceDescriptor, sources[2] as FieldSourceDescriptor, sources[0] as FieldSourceDescriptor]),
    );

    for (const point of [
      [0, 0, 0],
      [0.2, 0.1, -0.3],
      [-0.5, 0.4, 0.2],
    ] as const) {
      const first = forward.sample(point[0], point[1], point[2], createFieldSample());
      const second = reversed.sample(point[0], point[1], point[2], createFieldSample());
      const third = shuffled.sample(point[0], point[1], point[2], createFieldSample());
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    }
  });

  it('reverses a source effect when only its sign changes', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('threshold', 0, 0.8, 1)]));
    sampler.sample(0.2, 0, 0, sample);
    const asFood = sample.food;
    expect(asFood).toBeGreaterThan(0);
    expect(sample.kill).toBe(0);

    sampler.setStrength('threshold', -0.8);
    sampler.sample(0.2, 0, 0, sample);
    expect(sample.food).toBe(0);
    expect(sample.kill).toBeCloseTo(asFood, 6);
    expect(sample.contactSign).toBe(-1);
  });
});

describe('non-metabolic channels', () => {
  it('takes the minimum signed obstacle distance with its normal', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([
        {
          id: 'far-wall',
          geometry: { kind: 'box', center: [0, 0, -2], halfExtents: [2, 2, 0.1] },
          channels: { obstacle: true },
        },
        {
          id: 'near-floor',
          geometry: { kind: 'box', center: [0, -0.5, 0], halfExtents: [2, 0.1, 2] },
          channels: { obstacle: true },
        },
      ]),
    );
    // The floor's top face sits at y = -0.4 and the wall's near face at
    // z = -1.9, so the floor is the closer of the two.
    sampler.sample(0, 0.2, 0, sample);
    expect(sample.obstacleDistance).toBeCloseTo(0.6, 5);
    expect(sample.obstacleNormalY).toBeCloseTo(1, 5);
  });

  it('clamps the obstacle distance to one meter in both directions', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([
        {
          id: 'slab',
          geometry: { kind: 'box', center: [0, 0, 0], halfExtents: [4, 4, 4] },
          channels: { obstacle: true },
        },
      ]),
    );
    sampler.sample(0, 0, 0, sample);
    expect(sample.obstacleDistance).toBe(-1);
    sampler.sample(7, 0, 0, sample);
    expect(sample.obstacleDistance).toBe(1);
  });

  it('combines shelter with a saturating union and clamps to one', () => {
    const shelter = (id: string, x: number, value: number): FieldSourceDescriptor => ({
      id,
      geometry: { kind: 'box', center: [x, 0, 0], halfExtents: [0.5, 0.5, 0.5] },
      channels: { shelter: value },
    });
    const sampler = new EnvironmentFieldSampler(
      manifest([shelter('a', -0.25, 0.5), shelter('b', 0.25, 0.5)]),
    );
    sampler.sample(0, 0, 0, sample);
    expect(sample.shelter).toBeCloseTo(0.75, 5);
    expect(sample.shelter).toBeLessThanOrEqual(1);
  });

  it('averages habitat by weight and reports zeros with no contribution', () => {
    const habitat = (id: string, x: number, value: [number, number, number]): FieldSourceDescriptor => ({
      id,
      geometry: { kind: 'box', center: [x, 0, 0], halfExtents: [1, 1, 1] },
      channels: { habitat: value },
    });
    const sampler = new EnvironmentFieldSampler(
      manifest([habitat('a', -0.5, [1, 0, 0]), habitat('b', 0.5, [0, 1, 0])]),
    );
    sampler.sample(0, 0, 0, sample);
    expect(sample.habitatA).toBeCloseTo(0.5, 5);
    expect(sample.habitatB).toBeCloseTo(0.5, 5);
    expect(sample.habitatC).toBe(0);

    sampler.sample(6, 0, 0, sample);
    expect([sample.habitatA, sample.habitatB, sample.habitatC]).toEqual([0, 0, 0]);
  });

  it('sums flow and clamps the magnitude to one meter per second', () => {
    const current = (id: string, flow: [number, number, number]): FieldSourceDescriptor => ({
      id,
      geometry: { kind: 'box', center: [0, 0, 0], halfExtents: [1, 1, 1] },
      channels: { flow },
    });
    const sampler = new EnvironmentFieldSampler(
      manifest([current('a', [0.8, 0, 0]), current('b', [0.8, 0, 0])]),
    );
    sampler.sample(0, 0, 0, sample);
    expect(Math.hypot(sample.flowX, sample.flowY, sample.flowZ)).toBeCloseTo(1, 5);
    expect(sample.flowX).toBeCloseTo(1, 5);
  });
});

describe('gradient, contact, and batching', () => {
  it('matches the central-difference reference gradient', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([
        foodSource('feed', -0.6, 0.9, 1.1),
        foodSource('hazard', 0.7, -0.8, 1),
        {
          id: 'shell',
          geometry: { kind: 'sphere', center: [0, 0.5, 0.2], radiusMeters: 0.3 },
          channels: { effect: { strength: 0.6, rangeMeters: 0.7 } },
        },
      ]),
    );

    for (const point of [
      [0, 0, 0],
      [-0.2, 0.1, 0.1],
      [0.3, 0.35, -0.2],
      [0.15, 0.6, 0.3],
    ] as const) {
      const analytic = sampler.sample(point[0], point[1], point[2], createFieldSample());
      const numeric = sampler.sampleEffectGradientNumeric(
        point[0],
        point[1],
        point[2],
        createFieldSample(),
      );
      expect(analytic.gradientX).toBeCloseTo(numeric.gradientX, 2);
      expect(analytic.gradientY).toBeCloseTo(numeric.gradientY, 2);
      expect(analytic.gradientZ).toBeCloseTo(numeric.gradientZ, 2);
      expect(analytic.gradientMagnitude).toBeCloseTo(numeric.gradientMagnitude, 2);
    }
  });

  it('reports the contact point and normal of a mesh-bound source', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([
        {
          id: 'membrane',
          geometry: {
            kind: 'mesh',
            triangles: [-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
          },
          channels: { effect: { strength: 1, rangeMeters: 0.5 } },
        },
      ]),
    );
    sampler.sample(0.2, 0.25, -0.1, sample);
    expect(sample.contactSourceIndex).toBe(0);
    expect(sample.contactSign).toBe(1);
    expect(sample.contactY).toBeCloseTo(0, 5);
    expect(sample.contactX).toBeCloseTo(0.2, 5);
    expect(sample.contactNormalY).toBeCloseTo(1, 5);
  });

  it('packs batched samples in the documented channel order', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([foodSource('feed', 0, 1, 1), foodSource('hazard', 1.5, -1, 1)]),
    );
    const positions = Float32Array.from([0.2, 0, 0, 1.4, 0, 0, 5, 0, 0]);
    const batch = new Float32Array(3 * FIELD_BATCH_STRIDE);
    const contacts = new Int32Array(3);
    sampler.sampleBatch(positions, 3, batch, contacts);

    for (let cell = 0; cell < 3; cell += 1) {
      const single = sampler.sample(
        positions[cell * 3] ?? 0,
        positions[cell * 3 + 1] ?? 0,
        positions[cell * 3 + 2] ?? 0,
        createFieldSample(),
      );
      const offset = cell * FIELD_BATCH_STRIDE;
      expect(batch[offset]).toBeCloseTo(single.food, 6);
      expect(batch[offset + 1]).toBeCloseTo(single.kill, 6);
      expect(batch[offset + 2]).toBeCloseTo(single.effect, 6);
      expect(batch[offset + 7]).toBeCloseTo(single.obstacleDistance, 6);
      expect(batch[offset + 11]).toBeCloseTo(single.shelter, 6);
      expect(contacts[cell]).toBe(single.contactSourceIndex);
    }
  });

  it('rejects a batch buffer that is too small', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('feed', 0)]));
    expect(() => sampler.sampleBatch(new Float32Array(3), 1, new Float32Array(4))).toThrow(RangeError);
  });
});

describe('depletion, regeneration, and runtime edits', () => {
  it('drains a finite reserve and regenerates it over time', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([
        {
          id: 'feed',
          geometry: { kind: 'point', position: [0, 0, 0] },
          channels: {
            effect: {
              strength: 1,
              rangeMeters: 1,
              reserve: { capacity: 1, regenerationPerSecond: 0.5 },
            },
          },
        },
      ]),
    );

    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBeCloseTo(1, 5);

    expect(sampler.drawReserve(0, 0.5)).toBeCloseTo(0.5, 6);
    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBeCloseTo(0.5, 5);

    expect(sampler.drawReserve(0, 5)).toBeCloseTo(0.5, 6);
    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBe(0);

    sampler.advance(1);
    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBeCloseTo(0.5, 5);

    sampler.advance(10);
    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBeCloseTo(1, 5);
  });

  it('treats an unlimited source as always full', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('feed', 0, 1, 1)]));
    sampler.drawReserve(0, 1000);
    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBeCloseTo(1, 5);
  });

  it('moves a source without rebuilding the index', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('drifter', 0, 1, 0.5)]));
    sampler.sample(3, 0, 0, sample);
    expect(sample.food).toBe(0);

    sampler.moveSource('drifter', [3, 0, 0]);
    sampler.sample(3, 0, 0, sample);
    expect(sample.food).toBeCloseTo(1, 5);
    sampler.sample(0, 0, 0, sample);
    expect(sample.food).toBe(0);
  });

  it('adds and removes painted sources in stable ID order', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('b-existing', 0, 1, 1)]));
    sampler.addSource({
      id: 'a-painted',
      geometry: { kind: 'point', position: [2, 0, 0] },
      channels: { effect: { strength: -1, rangeMeters: 0.5 } },
    });
    expect(sampler.sources.map((source) => source.id)).toEqual(['a-painted', 'b-existing']);

    sampler.sample(2, 0, 0, sample);
    expect(sample.kill).toBeCloseTo(1, 5);

    sampler.removeSource('a-painted');
    sampler.sample(2, 0, 0, sample);
    expect(sample.kill).toBe(0);
    expect(() => sampler.removeSource('a-painted')).toThrow(RangeError);
  });

  it('rejects an unusable authored range', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('feed', 0)]));
    expect(() => sampler.setRange('feed', 0)).toThrow(RangeError);
    expect(() => sampler.setRange('missing', 1)).toThrow(RangeError);
  });
});

describe('spawn placement', () => {
  it('places deterministically inside the contract limits', () => {
    const sampler = new EnvironmentFieldSampler(manifest([foodSource('hazard', 0, -1, 1)]));
    const first = sampler.placeSpawn('test-spawn', 0);
    const repeat = sampler.placeSpawn('test-spawn', 0);
    expect(first).toBeDefined();
    expect(repeat).toEqual(first);

    const placed = first as [number, number, number];
    sampler.sample(placed[0], placed[1], placed[2], sample);
    expect(sample.kill).toBeLessThanOrEqual(0.05);
    expect(sample.food).toBeLessThanOrEqual(0.1);
    expect(sampler.placeSpawn('test-spawn', 1)).not.toEqual(first);
  });

  it('reports failure instead of drifting when the region is unusable', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([
        {
          id: 'flood',
          geometry: { kind: 'box', center: [0, 4, 0], halfExtents: [4, 4, 4] },
          channels: { effect: { strength: -1, rangeMeters: 2 } },
        },
      ]),
    );
    expect(sampler.placeSpawn('test-spawn', 0)).toBeUndefined();
    expect(sampler.placeSpawn('missing-region', 0)).toBeUndefined();
  });

  it('skips points inside an exclusion volume', () => {
    const sampler = new EnvironmentFieldSampler(
      manifest([foodSource('quiet', 6, 0.1, 0.2)], {
        exclusionRegions: [
          {
            id: 'no-spawn',
            volume: { kind: 'box', center: [0, 4, 0], halfExtents: [1, 1, 1] },
          },
        ],
      }),
    );
    expect(sampler.isExcluded(0, 4, 0)).toBe(true);
    expect(sampler.isExcluded(0, 0, 0)).toBe(false);
    expect(sampler.placeSpawn('test-spawn', 0)).toBeUndefined();
  });
});
