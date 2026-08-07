import { describe, expect, it } from 'vitest';
import {
  createSurfaceQuery,
  evaluateGeometry,
  geometryBounds,
  translateGeometry,
} from '../src/fields/shapes';
import type { FieldGeometry } from '../src/fields/types';

const query = createSurfaceQuery();

describe('field geometry adapters', () => {
  it('measures point sources from their center', () => {
    const geometry: FieldGeometry = { kind: 'point', position: [1, 2, 3] };
    evaluateGeometry(geometry, 1, 2, 3.5, query);
    expect(query.distance).toBeCloseTo(0.5, 6);
    expect(query.normalZ).toBeCloseTo(1, 6);
    expect([query.pointX, query.pointY, query.pointZ]).toEqual([1, 2, 3]);
  });

  it('reports signed distance inside and outside a sphere', () => {
    const geometry: FieldGeometry = { kind: 'sphere', center: [0, 0, 0], radiusMeters: 0.5 };
    evaluateGeometry(geometry, 0, 0, 1.25, query);
    expect(query.distance).toBeCloseTo(0.75, 6);
    expect(query.pointZ).toBeCloseTo(0.5, 6);

    evaluateGeometry(geometry, 0, 0, 0.2, query);
    expect(query.distance).toBeCloseTo(-0.3, 6);
    expect(query.normalZ).toBeCloseTo(1, 6);
  });

  it('pushes out of a box along the axis of least penetration', () => {
    const geometry: FieldGeometry = {
      kind: 'box',
      center: [0, 0, 0],
      halfExtents: [1, 0.2, 1],
    };
    evaluateGeometry(geometry, 0, 0.15, 0, query);
    expect(query.distance).toBeCloseTo(-0.05, 6);
    expect(query.normalY).toBeCloseTo(1, 6);
    expect(query.pointY).toBeCloseTo(0.2, 6);

    evaluateGeometry(geometry, 0, 0.5, 0, query);
    expect(query.distance).toBeCloseTo(0.3, 6);
    expect(query.normalY).toBeCloseTo(1, 6);
  });

  it('respects box yaw', () => {
    const geometry: FieldGeometry = {
      kind: 'box',
      center: [0, 0, 0],
      halfExtents: [1, 0.1, 0.1],
      yawRadians: Math.PI / 2,
    };
    // Yawed a quarter turn, the long axis now runs along Z.
    evaluateGeometry(geometry, 0, 0, 0.9, query);
    expect(query.distance).toBeLessThan(0);
    evaluateGeometry(geometry, 0.9, 0, 0, query);
    expect(query.distance).toBeGreaterThan(0);
  });

  it('measures a capsule from its nearest path segment', () => {
    const geometry: FieldGeometry = {
      kind: 'capsule',
      path: [
        [0, 0, 0],
        [0, 1, 0],
      ],
      radiusMeters: 0.1,
    };
    evaluateGeometry(geometry, 0.6, 0.5, 0, query);
    expect(query.distance).toBeCloseTo(0.5, 6);
    evaluateGeometry(geometry, 0, 2, 0, query);
    expect(query.distance).toBeCloseTo(0.9, 6);
  });

  it('keeps the sign over a plane footprint and drops it past the edge', () => {
    const geometry: FieldGeometry = {
      kind: 'plane',
      center: [0, 0, 0],
      normal: [0, 1, 0],
      halfExtents: [1, 1],
    };
    evaluateGeometry(geometry, 0, -0.25, 0, query);
    expect(query.distance).toBeCloseTo(-0.25, 6);
    expect(query.normalY).toBeCloseTo(-1, 6);

    evaluateGeometry(geometry, 3, 0, 0, query);
    expect(query.distance).toBeCloseTo(2, 6);
    expect(query.distance).toBeGreaterThan(0);
  });

  it('returns a usable contact point and normal for a mesh-bound source', () => {
    const geometry: FieldGeometry = {
      kind: 'mesh',
      triangles: [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1],
    };
    evaluateGeometry(geometry, 0.25, 0.4, 0.25, query);
    expect(query.distance).toBeCloseTo(0.4, 6);
    expect(query.pointY).toBeCloseTo(0, 6);
    expect(query.normalY).toBeCloseTo(1, 6);

    evaluateGeometry(geometry, 0.25, -0.4, 0.25, query);
    expect(query.normalY).toBeCloseTo(-1, 6);
  });

  it('bounds and translates every adapter', () => {
    const geometries: FieldGeometry[] = [
      { kind: 'point', position: [1, 1, 1] },
      { kind: 'sphere', center: [0, 0, 0], radiusMeters: 0.5 },
      { kind: 'box', center: [1, 0, 0], halfExtents: [0.5, 0.5, 0.5] },
      { kind: 'capsule', path: [[0, 0, 0], [0, 1, 0]], radiusMeters: 0.1 },
      { kind: 'plane', center: [0, 0, 0], normal: [0, 1, 0], halfExtents: [1, 1] },
      { kind: 'mesh', triangles: [0, 0, 0, 1, 0, 0, 0, 0, 1] },
    ];

    for (const geometry of geometries) {
      const before = geometryBounds(geometry);
      const moved = geometryBounds(translateGeometry(geometry, [2, 0, 0]));
      expect(moved.min[0]).toBeCloseTo(before.min[0] + 2, 6);
      expect(moved.max[0]).toBeCloseTo(before.max[0] + 2, 6);
      expect(moved.min[1]).toBeCloseTo(before.min[1], 6);
    }
  });
});
