import { vec3 } from '../environments/fields';
import type { SceneDescriptor } from './types';

/**
 * Static porcelain test environment for the P14 spike.
 *
 * Deliberately pure data with authored IDs — no Three.js, no materials, no
 * environment-specific behaviour. It mirrors the Home graybox proportions in
 * `src/environments/home.ts` closely enough to be representative without
 * importing the renderer scene.
 */
export const PORCELAIN_TEST_SCENE: SceneDescriptor = {
  id: 'porcelain-spatial-test',
  bodies: [
    {
      id: 'floor',
      role: 'obstacle',
      shape: { kind: 'box', halfExtents: vec3(3.2, 0.06, 2.4) },
      position: vec3(0, -0.06, 0),
    },
    {
      id: 'wall-north',
      role: 'obstacle',
      shape: { kind: 'box', halfExtents: vec3(3.2, 1.6, 0.06) },
      position: vec3(0, 1.6, -2.34),
    },
    {
      id: 'wall-west',
      role: 'obstacle',
      shape: { kind: 'box', halfExtents: vec3(0.06, 1.6, 2.4) },
      position: vec3(-3.14, 1.6, 0),
    },
    {
      id: 'table',
      role: 'obstacle',
      shape: { kind: 'box', halfExtents: vec3(0.9, 0.055, 0.4) },
      position: vec3(0.8, 0.76, -0.6),
    },
    {
      id: 'stair-block',
      role: 'obstacle',
      shape: { kind: 'box', halfExtents: vec3(0.45, 0.45, 0.21) },
      position: vec3(-2.3, 0.45, 0.9),
    },
    {
      id: 'threshold-volume',
      role: 'trigger',
      shape: { kind: 'box', halfExtents: vec3(0.45, 0.35, 0.12) },
      position: vec3(2.7, 0.35, 0.55),
    },
    {
      id: 'alcove-volume',
      role: 'trigger',
      shape: { kind: 'sphere', radius: 0.55 },
      position: vec3(-2.3, 0.6, 1.4),
    },
  ],
};
