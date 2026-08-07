import { describe, expect, it } from 'vitest';
import {
  CENTRAL_DIFFERENCE_STEP_METERS,
  FieldValidationError,
  centralDifferenceEffectGradient,
  createSignedEffectField,
  probeGeometry,
  smootherstep,
  validateEffectSources,
  vec3,
} from '../src/environments/fields';
import type { EffectSource, SignedFieldSample, Vec3 } from '../src/environments/fields';

const FIELD_SOURCE_FILES: Record<string, string> = import.meta.glob(
  '../src/environments/fields/*.ts',
  { query: '?raw', import: 'default', eager: true },
);

function point(strength: number, rangeMeters: number, id = 'point-source'): EffectSource {
  return {
    id,
    strength,
    rangeMeters,
    geometry: { kind: 'point', position: vec3(0, 0, 0) },
  };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('signed effect falloff endpoints', () => {
  it('returns the authored strength at zero distance', () => {
    const field = createSignedEffectField([point(0.8, 0.45)]);
    const sample = field.sample(vec3(0, 0, 0));
    expect(sample.food).toBe(Math.fround(0.8));
    expect(sample.kill).toBe(0);
    expect(sample.netEffect).toBe(Math.fround(0.8));
  });

  it('returns zero at and beyond the authored range', () => {
    const field = createSignedEffectField([point(1, 0.5)]);
    expect(field.sample(vec3(0.5, 0, 0)).food).toBe(0);
    expect(field.sample(vec3(0.5000001, 0, 0)).food).toBe(0);
    expect(field.sample(vec3(4, 0, 0)).food).toBe(0);
    expect(field.sample(vec3(0.25, 0, 0)).food).toBe(Math.fround(smootherstep(0.5)));
  });

  it('follows the contract smootherstep curve between the endpoints', () => {
    const field = createSignedEffectField([point(1, 1)]);
    for (const distance of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(field.sample(vec3(distance, 0, 0)).food).toBeCloseTo(
        smootherstep(1 - distance),
        6,
      );
    }
  });
});

describe('independent food and kill aggregation', () => {
  it('reports positive-only exposure', () => {
    const sample = createSignedEffectField([point(0.6, 1, 'feed')]).sample(vec3(0, 0, 0));
    expect(sample.food).toBe(Math.fround(0.6));
    expect(sample.kill).toBe(0);
    expect(sample.foodSourceIds).toEqual(['feed']);
    expect(sample.killSourceIds).toEqual([]);
  });

  it('reports negative-only exposure', () => {
    const sample = createSignedEffectField([point(-0.6, 1, 'fault')]).sample(vec3(0, 0, 0));
    expect(sample.food).toBe(0);
    expect(sample.kill).toBe(Math.fround(0.6));
    expect(sample.netEffect).toBe(Math.fround(-0.6));
    expect(sample.killSourceIds).toEqual(['fault']);
  });

  it('treats a zero-strength source as neutral', () => {
    const sample = createSignedEffectField([point(0, 1, 'neutral')]).sample(vec3(0, 0, 0));
    expect(sample.food).toBe(0);
    expect(sample.kill).toBe(0);
    expect(sample.netEffect).toBe(0);
    expect(sample.contributingSourceIds).toEqual([]);
  });

  it('keeps equal food and kill exposure live instead of cancelling it', () => {
    const sample = createSignedEffectField([point(1, 1, 'feed'), point(-1, 1, 'fault')]).sample(
      vec3(0, 0, 0),
    );
    expect(sample.food).toBe(1);
    expect(sample.kill).toBe(1);
    expect(sample.netEffect).toBe(0);
    expect(sample.contributingSourceIds).toEqual(['fault', 'feed']);
    expect(sample.foodContact?.sourceId).toBe('feed');
    expect(sample.killContact?.sourceId).toBe('fault');
  });

  it('unions same-sign sources without exceeding one', () => {
    const overlapping = createSignedEffectField([
      { ...point(0.5, 1, 'a'), geometry: { kind: 'point', position: vec3(0, 0, 0) } },
      { ...point(0.5, 1, 'b'), geometry: { kind: 'point', position: vec3(0, 0, 0) } },
    ]).sample(vec3(0, 0, 0));
    expect(overlapping.food).toBe(Math.fround(0.75));

    const saturated = createSignedEffectField([point(1, 1, 'a'), point(1, 1, 'b')]).sample(
      vec3(0, 0, 0),
    );
    expect(saturated.food).toBe(1);
    expect(saturated.netEffect).toBe(1);
  });
});

describe('declaration order independence', () => {
  const sources: EffectSource[] = [
    { id: 'alpha', strength: 0.37, rangeMeters: 0.9, geometry: { kind: 'point', position: vec3(0.1, 0.2, -0.3) } },
    {
      id: 'beta',
      strength: -0.61,
      rangeMeters: 0.55,
      geometry: { kind: 'sphere', center: vec3(-0.2, 0.15, 0.25), radiusMeters: 0.12 },
    },
    {
      id: 'gamma',
      strength: 0.83,
      rangeMeters: 0.7,
      geometry: {
        kind: 'box',
        center: vec3(0.3, 0.05, 0.4),
        halfExtentsMeters: vec3(0.2, 0.02, 0.15),
      },
    },
    {
      id: 'delta',
      strength: -0.24,
      rangeMeters: 1.1,
      geometry: { kind: 'capsule', start: vec3(-0.4, 0, -0.4), end: vec3(0.4, 0.6, 0.4), radiusMeters: 0.05 },
    },
  ];

  it('produces identical float32 values and identity for every permutation', () => {
    const probes = [vec3(0, 0, 0), vec3(0.21, 0.11, 0.05), vec3(-0.35, 0.4, 0.2), vec3(1.4, 0.9, -1.2)];
    const reference = createSignedEffectField(sources);
    const expected = probes.map((probe) => reference.sample(probe));

    for (const permutation of permutations(sources)) {
      const field = createSignedEffectField(permutation);
      expect(field.sources.map((source) => source.id)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
      probes.forEach((probe, index) => {
        expect(field.sample(probe)).toStrictEqual(expected[index]);
      });
    }
  });
});

describe('declaration validation', () => {
  it('rejects a duplicate source ID', () => {
    expect(() => createSignedEffectField([point(0.5, 1, 'feed'), point(0.5, 1, 'feed')])).toThrow(
      FieldValidationError,
    );
    const issues = validateEffectSources([point(0.5, 1, 'feed'), point(0.5, 1, 'feed')]);
    expect(issues).toEqual([
      { sourceId: 'feed', field: 'id', message: 'duplicates an earlier source ID' },
    ]);
  });

  it('rejects a non-positive or non-finite range', () => {
    for (const rangeMeters of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const issues = validateEffectSources([point(0.5, rangeMeters, 'feed')]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.sourceId).toBe('feed');
      expect(issues[0]?.field).toBe('rangeMeters');
      expect(issues[0]?.message).toContain('must be greater than 0');
    }
  });

  it('rejects an out-of-range strength', () => {
    const issues = validateEffectSources([point(1.5, 1, 'feed'), point(-4, 1, 'fault')]);
    expect(issues.map((issue) => `${issue.sourceId}:${issue.field}`)).toEqual([
      'feed:strength',
      'fault:strength',
    ]);
  });

  it('names the offending source and field in the thrown message', () => {
    let caught: FieldValidationError | undefined;
    try {
      createSignedEffectField([
        {
          id: 'fault-kill',
          strength: -1,
          rangeMeters: 0.3,
          geometry: { kind: 'sphere', center: vec3(0, 0, 0), radiusMeters: 0 },
        },
      ]);
    } catch (error) {
      caught = error as FieldValidationError;
    }
    expect(caught).toBeInstanceOf(FieldValidationError);
    expect(caught?.message).toContain('fault-kill');
    expect(caught?.message).toContain('geometry.radiusMeters');
    expect(caught?.issues).toHaveLength(1);
  });

  it('reports unusable IDs, unknown geometry, and every offender at once', () => {
    const issues = validateEffectSources([
      { id: '', strength: 2, rangeMeters: 0, geometry: { kind: 'point', position: vec3(0, 0, 0) } },
      {
        id: 'mystery',
        strength: 0.5,
        rangeMeters: 1,
        geometry: { kind: 'torus', center: vec3(0, 0, 0) } as unknown as EffectSource['geometry'],
      },
      {
        id: 'flat-plane',
        strength: 0.5,
        rangeMeters: 1,
        geometry: { kind: 'plane', origin: vec3(0, 0, 0), normal: vec3(0, 0, 0) },
      },
    ]);
    expect(issues.map((issue) => `${issue.sourceId}:${issue.field}`)).toEqual([
      '<index 0>:id',
      '<index 0>:strength',
      '<index 0>:rangeMeters',
      'mystery:geometry.kind',
      'flat-plane:geometry.normal',
    ]);
  });
});

describe('shape distance, contact, and normal fixtures', () => {
  it('measures a sphere from its surface', () => {
    const probe = probeGeometry(
      { kind: 'sphere', center: vec3(1, 0.5, 0), radiusMeters: 0.25 },
      vec3(1.75, 0.5, 0),
    );
    expect(probe.distanceMeters).toBeCloseTo(0.5, 6);
    expect(probe.contactPoint).toEqual(vec3(1.25, 0.5, 0));
    expect(probe.normal).toEqual(vec3(1, 0, 0));
    expect(probe.inside).toBe(false);
  });

  it('reports zero distance inside a sphere and keeps a stable normal at the center', () => {
    const geometry = { kind: 'sphere', center: vec3(0, 0, 0), radiusMeters: 0.5 } as const;
    expect(probeGeometry(geometry, vec3(0.1, 0, 0)).distanceMeters).toBe(0);
    expect(probeGeometry(geometry, vec3(0.1, 0, 0)).inside).toBe(true);
    expect(probeGeometry(geometry, vec3(0, 0, 0)).normal).toEqual(vec3(0, 1, 0));
  });

  it('measures an axis-aligned box from its faces and corners', () => {
    const geometry = {
      kind: 'box',
      center: vec3(0, 0, 0),
      halfExtentsMeters: vec3(0.5, 0.25, 0.1),
    } as const;
    const face = probeGeometry(geometry, vec3(0, 0.75, 0));
    expect(face.distanceMeters).toBeCloseTo(0.5, 6);
    expect(face.contactPoint).toEqual(vec3(0, 0.25, 0));
    expect(face.normal).toEqual(vec3(0, 1, 0));

    const corner = probeGeometry(geometry, vec3(0.8, 0.55, 0.4));
    expect(corner.distanceMeters).toBeCloseTo(Math.hypot(0.3, 0.3, 0.3), 6);
    expect(corner.contactPoint).toEqual(vec3(0.5, 0.25, 0.1));

    const inside = probeGeometry(geometry, vec3(0.1, 0.05, 0.02));
    expect(inside.inside).toBe(true);
    expect(inside.distanceMeters).toBe(0);
    expect(inside.contactPoint).toEqual(vec3(0.1, 0.05, 0.1));
    expect(inside.normal).toEqual(vec3(0, 0, 1));
  });

  it('measures a capsule from its swept axis and clamps to the caps', () => {
    const geometry = {
      kind: 'capsule',
      start: vec3(-1, 0, 0),
      end: vec3(1, 0, 0),
      radiusMeters: 0.1,
    } as const;
    const middle = probeGeometry(geometry, vec3(0, 0.6, 0));
    expect(middle.distanceMeters).toBeCloseTo(0.5, 6);
    expect(middle.contactPoint).toEqual(vec3(0, 0.1, 0));
    expect(middle.normal).toEqual(vec3(0, 1, 0));

    const beyondCap = probeGeometry(geometry, vec3(2, 0, 0));
    expect(beyondCap.distanceMeters).toBeCloseTo(0.9, 6);
    expect(beyondCap.contactPoint).toEqual(vec3(1.1, 0, 0));

    const onAxis = probeGeometry(geometry, vec3(0.25, 0, 0));
    expect(onAxis.distanceMeters).toBe(0);
    expect(onAxis.inside).toBe(true);
    expect(onAxis.normal).toEqual(vec3(0, 0, 1));
  });

  it('measures a plane on both sides unless it is one-sided', () => {
    const twoSided = { kind: 'plane', origin: vec3(0, 0, 0), normal: vec3(0, 1, 0) } as const;
    expect(probeGeometry(twoSided, vec3(1, 0.4, -2)).distanceMeters).toBeCloseTo(0.4, 6);
    expect(probeGeometry(twoSided, vec3(1, -0.4, -2)).distanceMeters).toBeCloseTo(0.4, 6);
    expect(probeGeometry(twoSided, vec3(1, -0.4, -2)).normal).toEqual(vec3(0, -1, 0));
    expect(probeGeometry(twoSided, vec3(1, 0.4, -2)).contactPoint).toEqual(vec3(1, 0, -2));

    const oneSided = { ...twoSided, oneSided: true } as const;
    expect(probeGeometry(oneSided, vec3(1, 0.4, -2)).distanceMeters).toBeCloseTo(0.4, 6);
    expect(probeGeometry(oneSided, vec3(1, -0.4, -2)).distanceMeters).toBe(
      Number.POSITIVE_INFINITY,
    );

    const behindPlane = createSignedEffectField([
      { id: 'floor-wash', strength: 0.7, rangeMeters: 0.5, geometry: oneSided },
    ]);
    expect(behindPlane.sample(vec3(0, -0.1, 0)).food).toBe(0);
    expect(behindPlane.sample(vec3(0, 0.1, 0)).food).toBeGreaterThan(0);
  });

  it('shares one sampling contract across every supported shape', () => {
    const shapes: EffectSource['geometry'][] = [
      { kind: 'point', position: vec3(0, 0, 0) },
      { kind: 'sphere', center: vec3(0, 0, 0), radiusMeters: 0.2 },
      { kind: 'box', center: vec3(0, 0, 0), halfExtentsMeters: vec3(0.2, 0.2, 0.2) },
      { kind: 'capsule', start: vec3(0, -0.2, 0), end: vec3(0, 0.2, 0), radiusMeters: 0.05 },
      { kind: 'plane', origin: vec3(0, 0, 0), normal: vec3(0, 1, 0) },
    ];

    for (const geometry of shapes) {
      const field = createSignedEffectField([
        { id: 'shape', strength: 0.9, rangeMeters: 0.4, geometry },
      ]);
      const probe = probeGeometry(geometry, vec3(0, 2, 0));
      // On the authored surface the sample equals the authored strength, and
      // beyond the range it is exactly zero, for every shape.
      expect(field.sample(probe.contactPoint).food).toBeCloseTo(0.9, 5);
      expect(field.sample(vec3(0, 2, 0)).food).toBe(0);
      expect(field.sample(vec3(0, 2, 0)).contributingSourceIds).toEqual([]);
    }
  });

  it('exposes the dominant contact and normal for localized emission', () => {
    const field = createSignedEffectField([
      {
        id: 'threshold-feed',
        strength: 0.8,
        rangeMeters: 0.45,
        geometry: {
          kind: 'box',
          center: vec3(2.7, 0.02, 0.55),
          halfExtentsMeters: vec3(0.425, 0.0125, 0.08),
        },
      },
      {
        id: 'window-beacon',
        strength: 0.3,
        rangeMeters: 0.45,
        geometry: { kind: 'point', position: vec3(2.7, 0.4, 0.55) },
      },
    ]);
    const sample = field.sample(vec3(2.7, 0.15, 0.55));
    expect(sample.foodSourceIds).toEqual(['threshold-feed', 'window-beacon']);
    expect(sample.foodContact?.sourceId).toBe('threshold-feed');
    expect(sample.foodContact?.point).toEqual(vec3(2.7, 0.0325, 0.55));
    expect(sample.foodContact?.normal).toEqual(vec3(0, 1, 0));
    expect(sample.foodContact?.contribution).toBeGreaterThan(0);
    expect(sample.killContact).toBeNull();
  });
});

describe('effect gradient', () => {
  it('points toward a food source and away from a kill source', () => {
    const food = createSignedEffectField([point(1, 1, 'feed')]).sample(vec3(0.5, 0, 0));
    expect(food.gradientDirection).toEqual(vec3(-1, 0, 0));
    expect(food.gradientMagnitude).toBeGreaterThan(0);

    const kill = createSignedEffectField([point(-1, 1, 'fault')]).sample(vec3(0.5, 0, 0));
    expect(kill.gradientDirection).toEqual(vec3(1, 0, 0));
  });

  it('vanishes on the surface, outside the range, and where food and kill mirror', () => {
    const field = createSignedEffectField([point(1, 1, 'feed')]);
    expect(field.sample(vec3(0, 0, 0)).gradientMagnitude).toBe(0);
    expect(field.sample(vec3(2, 0, 0)).gradientMagnitude).toBe(0);
    expect(field.sample(vec3(2, 0, 0)).gradientDirection).toEqual(vec3(0, 0, 0));

    const mirrored = createSignedEffectField([
      point(1, 1, 'feed'),
      { ...point(-1, 1, 'fault'), geometry: { kind: 'point', position: vec3(0, 0, 0) } },
    ]);
    expect(mirrored.sample(vec3(0.4, 0, 0)).gradientMagnitude).toBe(0);
  });

  it('matches a 1 cm central-difference sample', () => {
    const field = createSignedEffectField([
      {
        id: 'feed-box',
        strength: 0.8,
        rangeMeters: 0.6,
        geometry: {
          kind: 'box',
          center: vec3(0.2, 0, 0),
          halfExtentsMeters: vec3(0.15, 0.02, 0.1),
        },
      },
      {
        id: 'kill-capsule',
        strength: -0.9,
        rangeMeters: 0.5,
        geometry: {
          kind: 'capsule',
          start: vec3(-0.5, 0, -0.2),
          end: vec3(-0.5, 0.8, 0.2),
          radiusMeters: 0.03,
        },
      },
    ]);

    // Probes stay off box edges and corners, where the distance function has a
    // kink and the analytic result is a one-sided limit by construction.
    for (const probe of [
      vec3(0.2, 0.25, 0),
      vec3(-0.35, 0.3, 0),
      vec3(0.02, 0.2, 0.06),
      vec3(-0.2, 0.5, -0.14),
    ]) {
      const analytic = field.sample(probe).gradient;
      const numeric = centralDifferenceEffectGradient(field, probe, CENTRAL_DIFFERENCE_STEP_METERS);
      expect(analytic.x).toBeCloseTo(numeric.x, 2);
      expect(analytic.y).toBeCloseTo(numeric.y, 2);
      expect(analytic.z).toBeCloseTo(numeric.z, 2);
    }
  });
});

describe('deterministic golden samples', () => {
  const goldenSources: EffectSource[] = [
    {
      id: 'fault-kill',
      strength: -1,
      rangeMeters: 0.3,
      geometry: {
        kind: 'capsule',
        start: vec3(-3.05, 0.35, -0.6),
        end: vec3(-3.05, 1.6, -0.45),
        radiusMeters: 0,
      },
    },
    {
      id: 'floor-wash',
      strength: 0.2,
      rangeMeters: 0.4,
      geometry: { kind: 'plane', origin: vec3(0, 0, 0), normal: vec3(0, 1, 0), oneSided: true },
    },
    {
      id: 'stair-hazard',
      strength: -0.45,
      rangeMeters: 0.5,
      geometry: { kind: 'sphere', center: vec3(-2.3, 0.5, 0.75), radiusMeters: 0.2 },
    },
    {
      id: 'threshold-feed',
      strength: 0.8,
      rangeMeters: 0.45,
      geometry: {
        kind: 'box',
        center: vec3(2.7, 0.02, 0.55),
        halfExtentsMeters: vec3(0.425, 0.0125, 0.08),
      },
    },
    {
      id: 'window-beacon',
      strength: 0.5,
      rangeMeters: 0.5,
      geometry: { kind: 'point', position: vec3(1.7, 1.85, -2.24) },
    },
  ];

  const goldenProbes: Vec3[] = [
    vec3(0, 0.1, 0),
    vec3(2.7, 0.2, 0.55),
    vec3(2.4, 0.05, 0.6),
    vec3(-3.05, 0.9, -0.4),
    vec3(-2.9, 0.9, -0.4),
    vec3(-2.3, 0.85, 0.75),
    vec3(1.7, 1.6, -2.24),
    vec3(-1.2, 1.4, 1.9),
  ];

  function digest(sample: SignedFieldSample): Record<string, unknown> {
    return {
      food: sample.food,
      kill: sample.kill,
      netEffect: sample.netEffect,
      gradient: [sample.gradient.x, sample.gradient.y, sample.gradient.z],
      ids: sample.contributingSourceIds,
      foodContact: sample.foodContact?.sourceId ?? null,
      killContact: sample.killContact?.sourceId ?? null,
    };
  }

  it('returns byte-stable results across repeated runs and rebuilt fields', () => {
    const first = createSignedEffectField(goldenSources);
    const second = createSignedEffectField([...goldenSources].reverse());
    const firstRun = JSON.stringify(goldenProbes.map((probe) => first.sample(probe)));
    const repeatRun = JSON.stringify(goldenProbes.map((probe) => first.sample(probe)));
    const rebuiltRun = JSON.stringify(goldenProbes.map((probe) => second.sample(probe)));
    expect(repeatRun).toBe(firstRun);
    expect(rebuiltRun).toBe(firstRun);
  });

  it('matches the recorded golden samples', () => {
    const field = createSignedEffectField(goldenSources);
    expect(goldenProbes.map((probe) => digest(field.sample(probe)))).toEqual(GOLDEN_SAMPLES);
  });
});

describe('module purity', () => {
  it('imports in Node without a DOM, renderer, or network dependency', () => {
    // Every assertion in this file already runs the kernel in Vitest's Node
    // environment; this guards the sources against a later regression.
    const files = Object.entries(FIELD_SOURCE_FILES);
    expect(files.length).toBeGreaterThan(0);

    const forbidden = [
      /from '(three|@?three\/.*)'/,
      /\bdocument\b/,
      /\bwindow\b/,
      /\bnavigator\b/,
      /\bfetch\(/,
      /\bWebGL/,
      /\bcanvas\b/i,
      /\bMath\.random\b/,
      /\bDate\.now\b/,
      /\bperformance\.now\b/,
    ];

    for (const [path, contents] of files) {
      for (const pattern of forbidden) {
        expect(pattern.test(contents), `${path} must not reference ${pattern}`).toBe(false);
      }
    }
  });

  it('exposes a sample that only depends on its inputs', () => {
    const field = createSignedEffectField([point(0.75, 0.5, 'feed')]);
    const probe = vec3(0.2, 0.05, -0.1);
    expect(field.sample(probe)).toStrictEqual(field.sample(probe));
    expect(field.sources.map((source) => source.id)).toEqual(['feed']);
  });
});

/**
 * Recorded from the fixture scene above. These are exact float32 values, so a
 * change here means the sampling contract moved, not that noise crept in.
 */
const GOLDEN_SAMPLES: Record<string, unknown>[] = [
  {
    food: 0.1792968511581421,
    kill: 0,
    netEffect: 0.1792968511581421,
    gradient: [0, -0.52734375, 0],
    ids: ['floor-wash'],
    foodContact: 'floor-wash',
    killContact: null,
  },
  {
    food: 0.6251366138458252,
    kill: 0,
    netEffect: 0.6251366138458252,
    gradient: [0, -3.0114264488220215, 0],
    ids: ['floor-wash', 'threshold-feed'],
    foodContact: 'threshold-feed',
    killContact: null,
  },
  {
    food: 0.8390013575553894,
    kill: 0,
    netEffect: 0.8390013575553894,
    gradient: [0, -0.09581306576728821, 0],
    ids: ['floor-wash', 'threshold-feed'],
    foodContact: 'threshold-feed',
    killContact: null,
  },
  {
    food: 0,
    kill: 0.6050664782524109,
    netEffect: -0.6050664782524109,
    gradient: [0, -0.7257519364356995, 6.047933101654053],
    ids: ['fault-kill'],
    foodContact: null,
    killContact: 'fault-kill',
  },
  {
    food: 0,
    kill: 0.20740365982055664,
    netEffect: -0.20740365982055664,
    gradient: [3.675809621810913, -0.38845348358154297, 3.237112283706665],
    ids: ['fault-kill'],
    foodContact: null,
    killContact: 'fault-kill',
  },
  {
    food: 0,
    kill: 0.376613974571228,
    netEffect: -0.376613974571228,
    gradient: [0, 1.1907002925872803, 0],
    ids: ['stair-hazard'],
    foodContact: null,
    killContact: 'stair-hazard',
  },
  {
    food: 0.25,
    kill: 0,
    netEffect: 0.25,
    gradient: [0, 1.875, 0],
    ids: ['window-beacon'],
    foodContact: 'window-beacon',
    killContact: null,
  },
  {
    food: 0,
    kill: 0,
    netEffect: 0,
    gradient: [0, 0, 0],
    ids: [],
    foodContact: null,
    killContact: null,
  },
];
