import type { SpatialSceneDescriptor } from './joltSpatialQueryWorld';

/**
 * Static porcelain test environment for the P14 spike.
 *
 * Pure data with authored source IDs — no Three.js, no materials, no
 * environment-specific behaviour. Proportions mirror the Home graybox in
 * `src/environments/home.ts` closely enough to be representative without
 * importing the renderer scene.
 */
export const PORCELAIN_TEST_SCENE: SpatialSceneDescriptor = {
  id: 'porcelain-spatial-test',
  bodies: [
    { id: 'floor', role: 'obstacle', shape: { kind: 'box', halfExtents: { x: 3.2, y: 0.06, z: 2.4 } }, position: { x: 0, y: -0.06, z: 0 } },
    { id: 'wall-north', role: 'obstacle', shape: { kind: 'box', halfExtents: { x: 3.2, y: 1.6, z: 0.06 } }, position: { x: 0, y: 1.6, z: -2.34 } },
    { id: 'wall-west', role: 'obstacle', shape: { kind: 'box', halfExtents: { x: 0.06, y: 1.6, z: 2.4 } }, position: { x: -3.14, y: 1.6, z: 0 } },
    { id: 'table', role: 'obstacle', shape: { kind: 'box', halfExtents: { x: 0.9, y: 0.055, z: 0.4 } }, position: { x: 0.8, y: 0.76, z: -0.6 } },
    { id: 'stair-block', role: 'obstacle', shape: { kind: 'box', halfExtents: { x: 0.45, y: 0.45, z: 0.21 } }, position: { x: -2.3, y: 0.45, z: 0.9 } },
    { id: 'threshold-volume', role: 'trigger', shape: { kind: 'box', halfExtents: { x: 0.45, y: 0.35, z: 0.12 } }, position: { x: 2.7, y: 0.35, z: 0.55 } },
    { id: 'alcove-volume', role: 'trigger', shape: { kind: 'sphere', radius: 0.55 }, position: { x: -2.3, y: 0.6, z: 1.4 } },
  ],
};
