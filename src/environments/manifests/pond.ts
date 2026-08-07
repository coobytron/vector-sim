import type { EnvironmentManifest } from '../../fields/types';

/**
 * Prismatic Pond field manifest.
 *
 * Pond is the flow adaptation gate: the inlet feeds, the drain kills, the basin
 * is a neutral obstacle, and the current transports cells without touching
 * energy or health. Flow is an ordinary channel, so no simulation fork exists
 * for water.
 */
export const POND_MANIFEST: EnvironmentManifest = {
  schemaVersion: 'environment.v1',
  id: 'prismatic-pond',
  displayName: 'Prismatic Pond',
  units: 'meters',
  coordinateSystem: 'right-handed-y-up',
  bounds: { min: [-5, -2, -5], max: [5, 3, 5] },
  assets: [],
  sources: [
    {
      id: 'basin-shell',
      geometryId: 'pond-basin',
      geometry: { kind: 'box', center: [0, -0.9, 0], halfExtents: [3.6, 0.8, 3.6] },
      channels: { obstacle: true },
      tags: ['basin'],
    },
    {
      id: 'inlet-feed',
      geometryId: 'pond-inlet',
      geometry: { kind: 'sphere', center: [-2.4, 0.25, 0.4], radiusMeters: 0.28 },
      channels: {
        effect: {
          strength: 0.75,
          rangeMeters: 0.55,
          reserve: { capacity: 10, regenerationPerSecond: 0.4 },
        },
      },
      tags: ['inlet', 'food'],
    },
    {
      id: 'drain-kill',
      geometryId: 'pond-drain',
      geometry: { kind: 'sphere', center: [2.5, -0.05, -0.6], radiusMeters: 0.3 },
      channels: { effect: { strength: -1, rangeMeters: 0.5 } },
      tags: ['drain', 'kill'],
    },
    {
      id: 'surface-current',
      geometryId: 'pond-current',
      geometry: { kind: 'box', center: [0, 0.2, 0], halfExtents: [3, 0.35, 3] },
      channels: { flow: [0.42, 0, -0.18], auxiliaryRangeMeters: 0.5 },
      tags: ['current', 'transport'],
    },
    {
      id: 'reed-shelter',
      geometryId: 'pond-reeds',
      geometry: { kind: 'box', center: [-1.1, 0.4, 2.2], halfExtents: [0.7, 0.5, 0.5] },
      channels: { shelter: 0.5 },
      tags: ['shelter'],
    },
    {
      id: 'shallows-habitat',
      geometryId: 'pond-shallows',
      geometry: { kind: 'box', center: [1.2, 0.15, 2.0], halfExtents: [1.2, 0.3, 0.9] },
      channels: { habitat: [0.35, 0.4, 0.9] },
      tags: ['habitat', 'shallow'],
    },
  ],
  spawnRegions: [
    {
      id: 'shallows-spawn',
      geometryId: 'pond-spawn-volume',
      volume: { kind: 'box', center: [0.2, 1.1, 1.6], halfExtents: [0.6, 0.3, 0.6] },
      capacity: 8,
    },
  ],
  cameraPresets: [
    {
      id: 'pond-hero',
      target: [0, 0.4, 0],
      position: [4.4, 3.1, 5.0],
      verticalFovDegrees: 42,
      nearMeters: 0.05,
      farMeters: 45,
      safeBounds: { min: [-4, -1, -4], max: [4, 3, 4] },
      fallbackInput: 'pointer',
    },
    {
      id: 'pond-motion-look',
      target: [0, 0.4, 0],
      position: [4.4, 3.1, 5.0],
      verticalFovDegrees: 44,
      nearMeters: 0.05,
      farMeters: 45,
      safeBounds: { min: [-4, -1, -4], max: [4, 3, 4] },
      fallbackInput: 'touch',
    },
  ],
  looks: ['porcelain-spectrum', 'technical-wire', 'ghost-volume'],
  qualityTiers: ['mobile', 'desktop', 'export'],
};
