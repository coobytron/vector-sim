import type { EnvironmentManifest } from '../../fields/types';

/**
 * Spectral Homestead field manifest.
 *
 * Every source below mirrors a piece of the porcelain graybox in
 * `src/environments/home.ts`. Behaviour lives here, never in the mesh: the
 * renderer draws a threshold and a fault, and this manifest is what makes one
 * feed and the other kill.
 *
 * `assets` is empty while the environment is procedural. P09 authors the real
 * Home geometry and adds its checksummed asset entries.
 */
export const HOME_MANIFEST: EnvironmentManifest = {
  schemaVersion: 'environment.v1',
  id: 'spectral-home',
  displayName: 'Spectral Homestead',
  units: 'meters',
  coordinateSystem: 'right-handed-y-up',
  bounds: { min: [-6, -1, -4], max: [6, 4, 4] },
  assets: [],
  sources: [
    {
      id: 'floor-slab',
      geometryId: 'home-floor',
      geometry: { kind: 'box', center: [0, -0.06, 0], halfExtents: [3.2, 0.06, 2.4] },
      channels: { obstacle: true },
      tags: ['architecture', 'walkable'],
    },
    {
      id: 'wall-back',
      geometryId: 'home-wall-back',
      geometry: { kind: 'box', center: [0, 1.6, -2.34], halfExtents: [3.2, 1.6, 0.06] },
      channels: { obstacle: true },
      tags: ['architecture'],
    },
    {
      id: 'wall-side',
      geometryId: 'home-wall-side',
      geometry: { kind: 'box', center: [-3.14, 1.6, 0], halfExtents: [0.06, 1.6, 2.4] },
      channels: { obstacle: true },
      tags: ['architecture'],
    },
    {
      id: 'table-top',
      geometryId: 'home-table',
      geometry: { kind: 'box', center: [0.8, 0.76, -0.6], halfExtents: [0.9, 0.055, 0.4] },
      channels: { obstacle: true },
      tags: ['furniture', 'perch'],
    },
    {
      id: 'threshold-feed',
      geometryId: 'field-food-threshold',
      geometry: { kind: 'box', center: [2.7, 0.02, 0.55], halfExtents: [0.425, 0.0125, 0.08] },
      channels: {
        effect: {
          strength: 0.8,
          rangeMeters: 0.45,
          reserve: { capacity: 6, regenerationPerSecond: 0.25 },
        },
        obstacle: false,
      },
      tags: ['doorway', 'food'],
    },
    {
      id: 'fault-kill',
      geometryId: 'field-kill-fault',
      geometry: {
        kind: 'capsule',
        path: [
          [-3.05, 0.35, -0.6],
          [-3.05, 0.8, -0.35],
          [-3.05, 1.2, -0.7],
          [-3.05, 1.6, -0.45],
        ],
        radiusMeters: 0.02,
      },
      channels: { effect: { strength: -1, rangeMeters: 0.3 }, obstacle: false },
      tags: ['fracture', 'kill'],
    },
    {
      id: 'stair-alcove-shelter',
      geometryId: 'home-stairs',
      geometry: { kind: 'box', center: [-2.3, 0.5, 0.55], halfExtents: [0.5, 0.5, 1.1] },
      channels: { shelter: 0.75 },
      tags: ['shelter'],
    },
    {
      id: 'window-habitat',
      geometryId: 'home-window',
      geometry: { kind: 'box', center: [1.7, 1.85, -2.0], halfExtents: [0.75, 0.6, 0.35] },
      channels: { habitat: [0.9, 0.1, 0.2] },
      tags: ['habitat', 'daylight'],
    },
  ],
  spawnRegions: [
    {
      id: 'living-spawn',
      geometryId: 'home-spawn-volume',
      volume: { kind: 'box', center: [0.4, 1.0, 0.8], halfExtents: [0.6, 0.35, 0.6] },
      capacity: 8,
    },
  ],
  exclusionRegions: [
    {
      id: 'fault-exclusion',
      volume: { kind: 'box', center: [-2.9, 1.0, -0.5], halfExtents: [0.5, 0.9, 0.6] },
    },
  ],
  cameraPresets: [
    {
      id: 'home-hero',
      target: [0, 1, 0],
      position: [5.4, 3.75, 6.2],
      verticalFovDegrees: 42,
      nearMeters: 0.05,
      farMeters: 40,
      safeBounds: { min: [-3.4, 0, -2.6], max: [3.4, 3.2, 2.6] },
      fallbackInput: 'pointer',
    },
    {
      id: 'home-inspect',
      target: [1.6, 0.8, 0.4],
      position: [3.1, 1.6, 2.2],
      verticalFovDegrees: 38,
      nearMeters: 0.05,
      farMeters: 40,
      safeBounds: { min: [-3.4, 0, -2.6], max: [3.4, 3.2, 2.6] },
      fallbackInput: 'pointer',
    },
    {
      id: 'home-motion-look',
      target: [0, 1, 0],
      position: [5.4, 3.75, 6.2],
      verticalFovDegrees: 44,
      nearMeters: 0.05,
      farMeters: 40,
      safeBounds: { min: [-3.4, 0, -2.6], max: [3.4, 3.2, 2.6] },
      fallbackInput: 'touch',
    },
  ],
  looks: ['porcelain-spectrum', 'technical-wire', 'ghost-volume'],
  qualityTiers: ['mobile', 'desktop', 'export'],
};
