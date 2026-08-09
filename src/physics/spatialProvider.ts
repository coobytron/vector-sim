import { f32, vec3 } from '../environments/fields';
import type { FieldContact, FieldProvider, FieldProviderManifest, Vec3 } from '../environments/fields';
import { PROBE_RANGE_METERS } from './types';
import type { ProxyObservation, SpatialQueryWorld } from './types';

/**
 * Bridges geometry observations into the shared field-provider contract from
 * #8, so a ray/shape-derived signal reaches an organism through exactly the
 * same sensor path as `energy` and `danger` — no second sensing system.
 *
 * Channels are geometry-derived only. Nothing here invents metabolic meaning;
 * an obstacle is not food and a trigger volume is not danger.
 */
export const SPATIAL_CHANNELS = {
  /** Nearest obstacle distance, normalized to `[0, 1]` over the probe range. */
  obstacleDistance: 'obstacleDistance',
  /** `1` when the downward probe found ground, else `0`. */
  grounded: 'grounded',
  /** Unit surface normal of the ground contact. */
  groundNormal: 'groundNormal',
  /** Unit direction toward the nearest obstacle; zero when nothing is in range. */
  obstacleDirection: 'obstacleDirection',
} as const;

const MANIFEST_CHANNELS: FieldProviderManifest['channels'] = [
  { id: SPATIAL_CHANNELS.grounded, kind: 'scalar', semantic: 'contact-state' },
  { id: SPATIAL_CHANNELS.groundNormal, kind: 'vector', semantic: 'surface-normal' },
  { id: SPATIAL_CHANNELS.obstacleDirection, kind: 'vector', semantic: 'obstacle-bearing' },
  { id: SPATIAL_CHANNELS.obstacleDistance, kind: 'scalar', unit: 'normalized', semantic: 'obstacle-proximity' },
];

const ZERO: Vec3 = vec3(0, 0, 0);

/**
 * Converts one observation into normalized channel values.
 *
 * Exported so the normalization is testable without a live engine: given the
 * same observation, this must produce the same numbers on every platform.
 */
export function normalizeObservation(
  observation: ProxyObservation,
  probeRangeMeters: number = PROBE_RANGE_METERS,
): {
  readonly scalars: Record<string, number>;
  readonly vectors: Record<string, Vec3>;
  readonly sourceIds: readonly string[];
  readonly contacts: readonly FieldContact[];
} {
  const range = f32(probeRangeMeters);
  const clampedDistance = f32(Math.min(range, Math.max(0, observation.obstacleDistance)));
  const nearest = observation.nearestObstacle;

  let bearing = ZERO;
  if (nearest !== null) {
    const dx = f32(nearest.point.x - observation.position.x);
    const dy = f32(nearest.point.y - observation.position.y);
    const dz = f32(nearest.point.z - observation.position.z);
    const length = Math.hypot(dx, dy, dz);
    bearing = length > 0 ? vec3(dx / length, dy / length, dz / length) : ZERO;
  }

  // Contacts arrive sorted by source ID from the adapter; triggers are appended
  // and the union is re-sorted so the caller sees one ascending list.
  const contacts: FieldContact[] = observation.contacts.map((contact) => ({
    sourceId: contact.sourceId,
    point: contact.point,
    normal: contact.normal,
    distanceMeters: contact.distance,
    contribution: f32(1 - clampedDistance / range),
  }));

  const sourceIds = [
    ...observation.contacts.map((contact) => contact.sourceId),
    ...observation.triggers,
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    scalars: {
      [SPATIAL_CHANNELS.grounded]: observation.grounded ? 1 : 0,
      [SPATIAL_CHANNELS.obstacleDistance]: f32(clampedDistance / range),
    },
    vectors: {
      [SPATIAL_CHANNELS.groundNormal]: observation.groundNormal,
      [SPATIAL_CHANNELS.obstacleDirection]: bearing,
    },
    sourceIds,
    contacts,
  };
}

/**
 * A `FieldProvider` view of one organism's proxy.
 *
 * `sample()` ignores the sampled point and reports the proxy's current
 * observation: geometry sensing is proxy-relative, and re-querying at an
 * arbitrary point would silently disagree with the organism's own state. The
 * caller keeps the proxy position in step via `setProxyPosition`.
 */
export function createSpatialFieldProvider(
  world: SpatialQueryWorld,
  proxyId: string,
  probeRangeMeters: number = PROBE_RANGE_METERS,
): FieldProvider {
  const manifest: FieldProviderManifest = {
    id: `spatial:${proxyId}`,
    channels: MANIFEST_CHANNELS,
  };

  const sample = () => {
    const normalized = normalizeObservation(world.observe(proxyId), probeRangeMeters);
    return {
      scalars: normalized.scalars,
      vectors: normalized.vectors,
      sourceIds: normalized.sourceIds,
      contacts: normalized.contacts,
    };
  };

  return {
    manifest: Object.freeze({ ...manifest, channels: Object.freeze([...MANIFEST_CHANNELS]) }),
    sample,
    sampleBatch(points) {
      return points.map(() => sample());
    },
  };
}
