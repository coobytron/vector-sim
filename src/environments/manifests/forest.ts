import type { EnvironmentManifest } from '../../fields/types';

/**
 * Vector Canopy field manifest.
 *
 * Forest adds no channel of its own. A root pad feeds, a trunk fault kills, the
 * terrain is a neutral obstacle, and the canopy conditions phenotype behaviour
 * through habitat — the same eight channels Home uses, pointed at different
 * geometry. Adapting an environment is authoring, not new runtime code.
 */
export const FOREST_MANIFEST: EnvironmentManifest = {
  schemaVersion: 'environment.v1',
  id: 'vector-canopy',
  displayName: 'Vector Canopy',
  units: 'meters',
  coordinateSystem: 'right-handed-y-up',
  bounds: { min: [-8, -1, -8], max: [8, 6, 8] },
  assets: [],
  sources: [
    {
      id: 'forest-floor',
      geometryId: 'canopy-terrain',
      geometry: { kind: 'plane', center: [0, 0, 0], normal: [0, 1, 0], halfExtents: [7, 7] },
      channels: { obstacle: true },
      tags: ['terrain'],
    },
    {
      id: 'root-feed',
      geometryId: 'canopy-root-pad',
      geometry: { kind: 'sphere', center: [1.4, 0.15, 1.1], radiusMeters: 0.35 },
      channels: {
        effect: {
          strength: 0.7,
          rangeMeters: 0.6,
          reserve: { capacity: 8, regenerationPerSecond: 0.2 },
        },
      },
      tags: ['root', 'food'],
    },
    {
      id: 'trunk-fault-kill',
      geometryId: 'canopy-trunk-fault',
      geometry: {
        kind: 'capsule',
        path: [
          [-1.8, 0.2, -1.2],
          [-1.8, 2.6, -1.2],
        ],
        radiusMeters: 0.22,
      },
      channels: { effect: { strength: -0.9, rangeMeters: 0.4 }, obstacle: true },
      tags: ['trunk', 'kill'],
    },
    {
      id: 'canopy-habitat',
      geometryId: 'canopy-crown',
      geometry: { kind: 'sphere', center: [0, 3.4, 0], radiusMeters: 2.6 },
      channels: { habitat: [0.2, 0.85, 0.4], auxiliaryRangeMeters: 1.2 },
      tags: ['habitat', 'shade'],
    },
    {
      id: 'hollow-shelter',
      geometryId: 'canopy-hollow',
      geometry: { kind: 'box', center: [2.6, 0.6, -2.2], halfExtents: [0.5, 0.6, 0.5] },
      channels: { shelter: 0.6 },
      tags: ['shelter'],
    },
  ],
  spawnRegions: [
    {
      id: 'clearing-spawn',
      geometryId: 'canopy-clearing',
      volume: { kind: 'box', center: [0.6, 1.1, 2.4], halfExtents: [0.7, 0.4, 0.7] },
      capacity: 8,
    },
  ],
  cameraPresets: [
    {
      id: 'canopy-hero',
      target: [0, 1.6, 0],
      position: [6.5, 4.2, 7.4],
      verticalFovDegrees: 44,
      nearMeters: 0.05,
      farMeters: 60,
      safeBounds: { min: [-7, 0, -7], max: [7, 6, 7] },
      fallbackInput: 'pointer',
    },
    {
      id: 'canopy-motion-look',
      target: [0, 1.6, 0],
      position: [6.5, 4.2, 7.4],
      verticalFovDegrees: 46,
      nearMeters: 0.05,
      farMeters: 60,
      safeBounds: { min: [-7, 0, -7], max: [7, 6, 7] },
      fallbackInput: 'touch',
    },
  ],
  looks: ['porcelain-spectrum', 'technical-wire', 'ghost-volume'],
  qualityTiers: ['mobile', 'desktop', 'export'],
};
