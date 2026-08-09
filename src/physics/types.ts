import type { Vec3 } from '../environments/fields';

/**
 * Spatial-query contract (P14 spike).
 *
 * Nothing in this file names a physics engine. Jolt lives behind
 * {@link SpatialQueryWorld}; NCA, field, lifecycle, and renderer code must only
 * ever see these types, so the engine stays swappable and the kill criteria in
 * issue #37 stay testable.
 */

export type StaticShape =
  | { readonly kind: 'box'; readonly halfExtents: Vec3 }
  | { readonly kind: 'sphere'; readonly radius: number };

export type BodyRole = 'obstacle' | 'trigger';

export interface StaticBodyDescriptor {
  /** Stable authored ID. This — never an engine handle — identifies a body. */
  readonly id: string;
  readonly shape: StaticShape;
  readonly position: Vec3;
  /** `obstacle` collides and blocks rays; `trigger` is a sensor volume. */
  readonly role: BodyRole;
}

export interface ProxyDescriptor {
  /** Stable organism ID. One small proxy per organism, never one per cell. */
  readonly id: string;
  readonly radius: number;
  readonly position: Vec3;
}

export interface SceneDescriptor {
  readonly id: string;
  readonly bodies: readonly StaticBodyDescriptor[];
  readonly gravity?: Vec3;
}

export interface RayQuery {
  readonly origin: Vec3;
  /** Need not be normalized; the adapter normalizes before casting. */
  readonly direction: Vec3;
  readonly maxDistance: number;
}

export interface RayObservation {
  /** Authored body ID, not an engine body index. */
  readonly sourceId: string;
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

/**
 * Everything one organism proxy learned from geometry this tick. All lists are
 * stable-sorted by authored source ID before they leave the adapter.
 */
export interface ProxyObservation {
  readonly proxyId: string;
  readonly position: Vec3;
  readonly grounded: boolean;
  readonly groundNormal: Vec3;
  /** Distance to the nearest obstacle along the probe set, clamped to the probe range. */
  readonly obstacleDistance: number;
  readonly nearestObstacle: RayObservation | null;
  /** Every probe hit, ascending by source ID. */
  readonly contacts: readonly RayObservation[];
  /** Trigger volumes currently containing the proxy centre, ascending. */
  readonly triggers: readonly string[];
}

export interface SpatialQueryWorld {
  /** `false` for the null world; callers must stay operational either way. */
  readonly enabled: boolean;
  /** Authored body IDs, ascending. */
  readonly bodyIds: readonly string[];
  readonly proxyIds: readonly string[];
  addProxy(descriptor: ProxyDescriptor): void;
  setProxyPosition(id: string, position: Vec3): void;
  step(deltaSeconds: number): void;
  observe(proxyId: string): ProxyObservation;
  castRay(query: RayQuery): RayObservation | null;
  /** Hash of proxy state, for repeat-run comparison. */
  stateHash(): string;
  destroy(): void;
}

/** Probe range used for obstacle sensing, in metres. */
export const PROBE_RANGE_METERS = 1;

export class SpatialWorldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpatialWorldError';
  }
}

export function validateScene(scene: SceneDescriptor): void {
  if (!scene.id) {
    throw new SpatialWorldError('scene requires a non-empty id');
  }
  const seen = new Set<string>();
  for (const body of scene.bodies) {
    if (!body.id) {
      throw new SpatialWorldError(`scene ${scene.id}: body requires a non-empty id`);
    }
    if (seen.has(body.id)) {
      throw new SpatialWorldError(`scene ${scene.id}: duplicate body id ${body.id}`);
    }
    seen.add(body.id);
    if (body.role !== 'obstacle' && body.role !== 'trigger') {
      throw new SpatialWorldError(`scene ${scene.id}: body ${body.id} has invalid role`);
    }
    if (body.shape.kind === 'sphere' && !(body.shape.radius > 0)) {
      throw new SpatialWorldError(`scene ${scene.id}: body ${body.id} radius must be > 0`);
    }
    if (body.shape.kind === 'box') {
      const { x, y, z } = body.shape.halfExtents;
      if (!(x > 0 && y > 0 && z > 0)) {
        throw new SpatialWorldError(`scene ${scene.id}: body ${body.id} halfExtents must all be > 0`);
      }
    }
  }
}
