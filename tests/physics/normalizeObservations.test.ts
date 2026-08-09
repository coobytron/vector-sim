import { describe, expect, it } from 'vitest';
import { normalizeSpatialObservations } from '../../src/physics/normalizeObservations';
import { NullSpatialQueryWorld } from '../../src/physics/nullSpatialQueryWorld';

const unordered = [
  { kind: 'ray-hit' as const, sourceId: 'wall-b', distance: 0.4, point: { x: 1, y: 0, z: 0 } },
  { kind: 'contact' as const, sourceId: 'wall-a', distance: 0, point: { x: 0, y: 0, z: 0 } },
  { kind: 'ray-hit' as const, sourceId: 'wall-a', distance: 0.8, point: { x: 2, y: 0, z: 0 } },
  { kind: 'ray-hit' as const, sourceId: 'wall-a', distance: 0.2, point: { x: 1, y: 0, z: 0 } },
];

describe('normalizeSpatialObservations', () => {
  it('produces stable ordering independent of input order', () => {
    const forward = normalizeSpatialObservations(unordered);
    const reverse = normalizeSpatialObservations([...unordered].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.map((hit) => `${hit.sourceId}:${hit.kind}:${hit.distance}`)).toEqual([
      'wall-a:contact:0',
      'wall-a:ray-hit:0.2',
      'wall-a:ray-hit:0.8',
      'wall-b:ray-hit:0.4',
    ]);
  });

  it('sanitizes non-finite numeric values before simulation consumption', () => {
    const [hit] = normalizeSpatialObservations([
      {
        kind: 'contact',
        sourceId: 'bad-data',
        distance: Number.NaN,
        point: { x: Number.POSITIVE_INFINITY, y: 2, z: Number.NEGATIVE_INFINITY },
      },
    ]);

    expect(hit?.distance).toBe(0);
    expect(hit?.point).toEqual({ x: 0, y: 2, z: 0 });
  });
});

describe('NullSpatialQueryWorld', () => {
  it('keeps the headless fallback free of external physics dependencies', () => {
    const world = new NullSpatialQueryWorld();
    expect(world.ready).toBe(true);
    expect(world.raycast({
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      maxDistance: 10,
    })).toEqual([]);
    expect(world.overlapSphere({ center: { x: 0, y: 0, z: 0 }, radius: 1 })).toEqual([]);
  });
});
