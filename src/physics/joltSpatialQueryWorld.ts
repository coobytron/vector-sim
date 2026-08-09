import { hashState } from '../simulation/hashState';
import { normalizeSpatialObservations } from './normalizeObservations';
import type {
  RayQuery,
  SpatialObservation,
  SpatialQueryWorld,
  SphereQuery,
  Vec3Like,
} from './types';

/**
 * Jolt-backed spatial-query world (P14b, issue #39).
 *
 * Implements the backend-neutral contract established in PR #38. This is the
 * only module in the repository that names Jolt: every value it returns is a
 * `SpatialObservation` carrying an authored Vector Sim source ID, so no engine
 * handle can reach NCA, lifecycle, field, renderer, or serialized state.
 *
 * Proxy management sits on this class rather than on `SpatialQueryWorld`,
 * because a proxy is a Jolt-side optimisation, not part of the shared query
 * boundary. Callers that only need the boundary keep using the interface.
 */

export type StaticShape =
  | { readonly kind: 'box'; readonly halfExtents: Vec3Like }
  | { readonly kind: 'sphere'; readonly radius: number };

export interface StaticBodyDescriptor {
  /** Stable Vector Sim source ID. Never a Jolt body index. */
  readonly id: string;
  readonly shape: StaticShape;
  readonly position: Vec3Like;
  readonly role: 'obstacle' | 'trigger';
}

export interface SpatialSceneDescriptor {
  readonly id: string;
  readonly bodies: readonly StaticBodyDescriptor[];
}

export interface ProxyDescriptor {
  /** Stable organism ID. One proxy per organism, never one per NCA cell. */
  readonly id: string;
  readonly radius: number;
  readonly position: Vec3Like;
}

export interface JoltWorldOptions {
  readonly scene: SpatialSceneDescriptor;
  /**
   * Loader for the single-threaded WASM build. Injected so the browser can pass
   * Vite's asset URL through `locateFile` and Node can resolve it directly.
   */
  readonly loadJolt: () => Promise<unknown>;
  readonly probeRangeMeters?: number;
}

export class SpatialWorldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpatialWorldError';
  }
}

/** Probe range used for obstacle sensing, in metres. */
export const PROBE_RANGE_METERS = 1;

/**
 * Object layers are the separation mechanism.
 *
 * Obstacles, organism proxies, and sensor volumes each get their own layer so a
 * query can name exactly what it wants: an obstacle ray never hits a proxy (not
 * even the one casting it) and never terminates on a sensor, and trigger
 * overlap never reports an obstacle.
 */
const LAYER_OBSTACLE = 0;
const LAYER_PROXY = 1;
const LAYER_SENSOR = 2;
const OBJECT_LAYERS = 3;
const BROAD_PHASE_LAYERS = 2;

/** Fixed probe order; results are sorted by source ID afterwards regardless. */
const PROBE_DIRECTIONS: readonly Vec3Like[] = [
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 0, z: 1 },
];

export function validateSpatialScene(scene: SpatialSceneDescriptor): void {
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

function normalizeDirection(direction: Vec3Like): Vec3Like {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 0)) {
    throw new SpatialWorldError('ray direction must be non-zero');
  }
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the Jolt emscripten
   bindings are untyped at this boundary; every value is converted into a
   SpatialObservation before it leaves this module. */

export class JoltSpatialQueryWorld implements SpatialQueryWorld {
  readonly kind = 'jolt' as const;

  /** Milliseconds spent instantiating the WASM module. */
  readonly initMs: number;

  private readonly Jolt: any;
  private readonly joltInterface: any;
  private readonly system: any;
  private readonly bodyInterface: any;
  private readonly probeRange: number;
  private readonly idByBodyIndex = new Map<number, string>();
  private readonly triggerIds = new Set<string>();
  private readonly proxyBodies = new Map<string, any>();
  private disposed = false;

  private constructor(jolt: any, options: JoltWorldOptions, initMs: number) {
    this.Jolt = jolt;
    this.initMs = initMs;
    this.probeRange = options.probeRangeMeters ?? PROBE_RANGE_METERS;

    const Jolt = this.Jolt;
    const objectFilter = new Jolt.ObjectLayerPairFilterTable(OBJECT_LAYERS);
    objectFilter.EnableCollision(LAYER_OBSTACLE, LAYER_PROXY);
    objectFilter.EnableCollision(LAYER_PROXY, LAYER_PROXY);
    objectFilter.EnableCollision(LAYER_SENSOR, LAYER_PROXY);

    const broadPhase = new Jolt.BroadPhaseLayerInterfaceTable(OBJECT_LAYERS, BROAD_PHASE_LAYERS);
    broadPhase.MapObjectToBroadPhaseLayer(LAYER_OBSTACLE, new Jolt.BroadPhaseLayer(0));
    broadPhase.MapObjectToBroadPhaseLayer(LAYER_PROXY, new Jolt.BroadPhaseLayer(1));
    broadPhase.MapObjectToBroadPhaseLayer(LAYER_SENSOR, new Jolt.BroadPhaseLayer(0));

    const settings = new Jolt.JoltSettings();
    settings.mObjectLayerPairFilter = objectFilter;
    settings.mBroadPhaseLayerInterface = broadPhase;
    settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
      broadPhase,
      BROAD_PHASE_LAYERS,
      objectFilter,
      OBJECT_LAYERS,
    );
    this.joltInterface = new Jolt.JoltInterface(settings);
    Jolt.destroy(settings);

    this.system = this.joltInterface.GetPhysicsSystem();
    this.bodyInterface = this.system.GetBodyInterface();

    // Bodies are created in sorted authored-ID order, so engine indices are a
    // function of the scene rather than of caller array order.
    const ordered = [...options.scene.bodies].sort((a, b) => a.id.localeCompare(b.id));
    for (const descriptor of ordered) {
      this.addStaticBody(descriptor);
    }
  }

  static async create(options: JoltWorldOptions): Promise<JoltSpatialQueryWorld> {
    validateSpatialScene(options.scene);
    const startedAt = Date.now();
    const jolt = await options.loadJolt();
    const initMs = Date.now() - startedAt;
    return new JoltSpatialQueryWorld(jolt, options, initMs);
  }

  get ready(): boolean {
    return !this.disposed;
  }

  /** Authored body IDs, ascending. */
  get bodyIds(): readonly string[] {
    return [...this.idByBodyIndex.values()].sort();
  }

  get proxyIds(): readonly string[] {
    return [...this.proxyBodies.keys()].sort();
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new SpatialWorldError('spatial world has been disposed');
    }
  }

  private addStaticBody(descriptor: StaticBodyDescriptor): void {
    const Jolt = this.Jolt;
    const shape =
      descriptor.shape.kind === 'box'
        ? new Jolt.BoxShape(
            new Jolt.Vec3(
              descriptor.shape.halfExtents.x,
              descriptor.shape.halfExtents.y,
              descriptor.shape.halfExtents.z,
            ),
            0.05,
            null,
          )
        : new Jolt.SphereShape(descriptor.shape.radius);

    const creation = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(descriptor.position.x, descriptor.position.y, descriptor.position.z),
      new Jolt.Quat(0, 0, 0, 1),
      Jolt.EMotionType_Static,
      descriptor.role === 'trigger' ? LAYER_SENSOR : LAYER_OBSTACLE,
    );
    if (descriptor.role === 'trigger') {
      creation.mIsSensor = true;
    }
    const body = this.bodyInterface.CreateBody(creation);
    Jolt.destroy(creation);
    this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);

    this.idByBodyIndex.set(body.GetID().GetIndexAndSequenceNumber(), descriptor.id);
    if (descriptor.role === 'trigger') {
      this.triggerIds.add(descriptor.id);
    }
  }

  private resolveSourceId(bodyId: any): string | null {
    return this.idByBodyIndex.get(bodyId.GetIndexAndSequenceNumber()) ?? null;
  }

  /**
   * Closest obstacle hit, as zero or one observation.
   *
   * Restricted to the obstacle layer, so a sensor cannot swallow a ray and a
   * proxy cannot occlude itself or another organism.
   */
  raycast(query: RayQuery): readonly SpatialObservation[] {
    this.assertLive();
    const Jolt = this.Jolt;
    const direction = normalizeDirection(query.direction);

    const ray = new Jolt.RRayCast();
    ray.mOrigin = new Jolt.RVec3(query.origin.x, query.origin.y, query.origin.z);
    ray.mDirection = new Jolt.Vec3(
      direction.x * query.maxDistance,
      direction.y * query.maxDistance,
      direction.z * query.maxDistance,
    );

    const collector = new Jolt.CastRayClosestHitCollisionCollector();
    const raySettings = new Jolt.RayCastSettings();
    const bpFilter = new Jolt.BroadPhaseLayerFilter();
    const olFilter = new Jolt.SpecifiedObjectLayerFilter(LAYER_OBSTACLE);
    const bodyFilter = new Jolt.BodyFilter();
    const shapeFilter = new Jolt.ShapeFilter();

    this.system
      .GetNarrowPhaseQuery()
      .CastRay(ray, raySettings, collector, bpFilter, olFilter, bodyFilter, shapeFilter);

    const found: SpatialObservation[] = [];
    if (collector.HadHit()) {
      const hit = collector.mHit;
      const sourceId = this.resolveSourceId(hit.mBodyID);
      if (sourceId !== null) {
        const point = ray.GetPointOnRay(hit.mFraction);
        const body = this.system.GetBodyLockInterfaceNoLock().TryGetBody(hit.mBodyID);
        const normal = body.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point);
        found.push({
          kind: 'ray-hit',
          sourceId,
          distance: hit.mFraction * query.maxDistance,
          point: { x: point.GetX(), y: point.GetY(), z: point.GetZ() },
          normal: { x: normal.GetX(), y: normal.GetY(), z: normal.GetZ() },
          metadata: { role: 'obstacle' },
        });
      }
    }

    Jolt.destroy(shapeFilter);
    Jolt.destroy(bodyFilter);
    Jolt.destroy(olFilter);
    Jolt.destroy(bpFilter);
    Jolt.destroy(raySettings);
    Jolt.destroy(collector);
    Jolt.destroy(ray);

    return normalizeSpatialObservations(found);
  }

  /**
   * Bodies overlapping a sphere, obstacles and trigger volumes alike, each
   * tagged with its role in `metadata`.
   */
  overlapSphere(query: SphereQuery): readonly SpatialObservation[] {
    this.assertLive();
    const Jolt = this.Jolt;

    const shape = new Jolt.SphereShape(query.radius);
    const transform = Jolt.RMat44.prototype.sTranslation(
      new Jolt.RVec3(query.center.x, query.center.y, query.center.z),
    );
    const collideSettings = new Jolt.CollideShapeSettings();
    const collector = new Jolt.CollideShapeAllHitCollisionCollector();
    const baseOffset = new Jolt.RVec3(0, 0, 0);
    const bpFilter = new Jolt.BroadPhaseLayerFilter();
    const olFilter = new Jolt.ObjectLayerFilter();
    const bodyFilter = new Jolt.BodyFilter();
    const shapeFilter = new Jolt.ShapeFilter();

    this.system
      .GetNarrowPhaseQuery()
      .CollideShape(
        shape,
        new Jolt.Vec3(1, 1, 1),
        transform,
        collideSettings,
        baseOffset,
        collector,
        bpFilter,
        olFilter,
        bodyFilter,
        shapeFilter,
      );

    const found: SpatialObservation[] = [];
    const hits = collector.mHits;
    for (let index = 0; index < hits.size(); index += 1) {
      const hit = hits.at(index);
      const sourceId = this.resolveSourceId(hit.mBodyID2);
      if (sourceId === null || this.proxyBodies.has(sourceId)) {
        continue;
      }
      const point = hit.mContactPointOn2;
      found.push({
        kind: 'overlap',
        sourceId,
        distance: Math.max(0, -hit.mPenetrationDepth),
        point: { x: point.GetX(), y: point.GetY(), z: point.GetZ() },
        metadata: { role: this.triggerIds.has(sourceId) ? 'trigger' : 'obstacle' },
      });
    }

    Jolt.destroy(shapeFilter);
    Jolt.destroy(bodyFilter);
    Jolt.destroy(olFilter);
    Jolt.destroy(bpFilter);
    Jolt.destroy(baseOffset);
    Jolt.destroy(collector);
    Jolt.destroy(collideSettings);
    Jolt.destroy(transform);
    Jolt.destroy(shape);

    return normalizeSpatialObservations(found);
  }

  step(dt: number): void {
    this.assertLive();
    if (!(dt > 0)) {
      throw new SpatialWorldError(`step delta must be > 0 (got ${dt})`);
    }
    this.joltInterface.Step(dt, 1);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // The adapter owns every allocation it made; JoltInterface teardown
    // releases the bodies and shapes registered above.
    this.Jolt.destroy(this.joltInterface);
    this.proxyBodies.clear();
    this.idByBodyIndex.clear();
  }

  addProxy(descriptor: ProxyDescriptor): void {
    this.assertLive();
    if (this.proxyBodies.has(descriptor.id)) {
      throw new SpatialWorldError(`proxy ${descriptor.id} already exists`);
    }
    if (!(descriptor.radius > 0)) {
      throw new SpatialWorldError(`proxy ${descriptor.id} radius must be > 0`);
    }
    const Jolt = this.Jolt;
    const shape = new Jolt.SphereShape(descriptor.radius);
    const creation = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(descriptor.position.x, descriptor.position.y, descriptor.position.z),
      new Jolt.Quat(0, 0, 0, 1),
      // Kinematic: the NCA owns motion, so Jolt never integrates organism
      // movement and cannot make it read as rigid-body dynamics.
      Jolt.EMotionType_Kinematic,
      LAYER_PROXY,
    );
    const body = this.bodyInterface.CreateBody(creation);
    Jolt.destroy(creation);
    this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
    this.proxyBodies.set(descriptor.id, body);
    this.idByBodyIndex.set(body.GetID().GetIndexAndSequenceNumber(), descriptor.id);
  }

  setProxyPosition(id: string, position: Vec3Like): void {
    this.assertLive();
    const body = this.proxyBodies.get(id);
    if (body === undefined) {
      throw new SpatialWorldError(`unknown proxy ${id}`);
    }
    this.bodyInterface.SetPosition(
      body.GetID(),
      new this.Jolt.RVec3(position.x, position.y, position.z),
      this.Jolt.EActivation_Activate,
    );
  }

  proxyPosition(id: string): Vec3Like {
    this.assertLive();
    const body = this.proxyBodies.get(id);
    if (body === undefined) {
      throw new SpatialWorldError(`unknown proxy ${id}`);
    }
    const position = body.GetPosition();
    return { x: position.GetX(), y: position.GetY(), z: position.GetZ() };
  }

  /**
   * Everything one organism proxy can sense: six obstacle probes plus a trigger
   * overlap, returned as one deterministically ordered observation list.
   */
  observeProxy(proxyId: string): readonly SpatialObservation[] {
    this.assertLive();
    const origin = this.proxyPosition(proxyId);
    const found: SpatialObservation[] = [];

    for (const direction of PROBE_DIRECTIONS) {
      const [hit] = this.raycast({ origin, direction, maxDistance: this.probeRange });
      if (hit !== undefined) {
        found.push(hit);
      }
    }
    for (const overlap of this.overlapSphere({ center: origin, radius: this.probeRange * 0.25 })) {
      if (overlap.metadata?.role === 'trigger') {
        found.push(overlap);
      }
    }

    return normalizeSpatialObservations(found);
  }

  /** Hash of proxy state, for repeat-run comparison. */
  stateHash(): string {
    this.assertLive();
    const ids = this.proxyIds;
    const values = new Float32Array(ids.length * 3);
    ids.forEach((id, index) => {
      const position = this.proxyPosition(id);
      values[index * 3] = position.x;
      values[index * 3 + 1] = position.y;
      values[index * 3 + 2] = position.z;
    });
    return hashState([values], ids.length);
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createJoltSpatialQueryWorld(
  options: JoltWorldOptions,
): Promise<JoltSpatialQueryWorld> {
  return JoltSpatialQueryWorld.create(options);
}
