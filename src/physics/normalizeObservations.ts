import type { SpatialObservation } from './types';

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function compareNumber(a: number, b: number): number {
  return finiteOrZero(a) - finiteOrZero(b);
}

export function normalizeSpatialObservations(
  observations: readonly SpatialObservation[],
): SpatialObservation[] {
  return observations
    .map((observation) => ({
      ...observation,
      distance: finiteOrZero(observation.distance),
      point: observation.point
        ? {
            x: finiteOrZero(observation.point.x),
            y: finiteOrZero(observation.point.y),
            z: finiteOrZero(observation.point.z),
          }
        : undefined,
      normal: observation.normal
        ? {
            x: finiteOrZero(observation.normal.x),
            y: finiteOrZero(observation.normal.y),
            z: finiteOrZero(observation.normal.z),
          }
        : undefined,
    }))
    .sort((a, b) => {
      const source = a.sourceId.localeCompare(b.sourceId);
      if (source !== 0) return source;
      const kind = a.kind.localeCompare(b.kind);
      if (kind !== 0) return kind;
      const distance = compareNumber(a.distance, b.distance);
      if (distance !== 0) return distance;
      const ax = a.point?.x ?? 0;
      const bx = b.point?.x ?? 0;
      if (ax !== bx) return compareNumber(ax, bx);
      const ay = a.point?.y ?? 0;
      const by = b.point?.y ?? 0;
      if (ay !== by) return compareNumber(ay, by);
      return compareNumber(a.point?.z ?? 0, b.point?.z ?? 0);
    });
}
