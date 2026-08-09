import { f32, vec3 } from '../environments/fields';
import type { Vec3 } from '../environments/fields';
import { hashState } from '../simulation/hashState';
import { PROBE_RANGE_METERS, SpatialWorldError, validateScene } from './types';
import type {
  ProxyDescriptor,
  ProxyObservation,
  RayObservation,
  RayQuery,
  SceneDescriptor,
  SpatialQueryWorld,
} from './types';

/**
 * Jolt-backed spatial-query world (P14 spike).
 *
 * This is the only file in the repository allowed to name Jolt. Everything it
 * returns is expressed in {@link SpatialQueryWorld} terms — authored string IDs
 * and plain vectors — so no engine handle can reach NCA, field, lifecycle, or
 * renderer code.
 *
 * Determinism strategy: Jolt body IDs are allocation-ordered and must never
 * leak, so every body is registered against its authored ID and every result
 * list is stable-sorted by that string before it is returned.
 */

/**
 * Object layers are the determinism and separation mechanism here.
 *
 * Obstacles, organism proxies, and sensor volumes each get their own layer so a
 * query can name exactly what it wants: obstacle rays never hit a proxy (not
 * even the one casting them) and never terminate on a sensor, and trigger
 * containment never reports an obstacle.
 */
const LAYER_OBSTACLE = 0;
const LAYER_PROXY = 1;
const LAYER_SENSOR = 2;
const OBJECT_LAYERS = 3;
const BROAD_PHASE_LAYERS = 2;

/** Probe directions used for obstacle sensing, in fixed order. */
const PROBE_DIRECTIONS: readonly Vec3[] = [
  vec3(0, -1, 0),
  vec3(0, 1, 0),
  vec3(-1, 0, 0),
  vec3(1, 0, 0),
  vec3(0, 0, -1),
  vec3(0, 0, 1),
];

export interface JoltWorldOptions {
  readonly scene: SceneDescriptor;
  /**
   * Loader for the single-threaded WASM build. Supplied by the caller so the
   * browser can hand Vite's asset URL through `locateFile` and Node can use the
   * package default. Multithreaded WASM is deliberately not required.
   */
  readonly loadJolt: () => Promise<unknown>;
  readonly probeRangeMeters?: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeDirection(direction: Vec3): Vec3 {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 0)) {
    throw new SpatialWorldError('ray direction must be non-zero');
  }
  return vec3(direction.x / length, direction.y / length, direction.z / length);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the Jolt emscripten
   bindings are untyped at this boundary; every value is converted to a plain
   contract type before it leaves this module. */

/**
 * Builds the world. Async because the WASM module must be instantiated first;
 * measure the returned `initMs` when reporting cold-start cost.
 */
export async function createJoltSpatialWorld(
  options: JoltWorldOptions,
): Promise<SpatialQueryWorld & { readonly initMs: number }> {
  validateScene(options.scene);
  const probeRange = f32(options.probeRangeMeters ?? PROBE_RANGE_METERS);

  const startedAt = Date.now();
  const Jolt = (await options.loadJolt()) as any;
  const initMs = Date.now() - startedAt;

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
  const joltInterface = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);

  const system = joltInterface.GetPhysicsSystem();
  const bodyInterface = system.GetBodyInterface();

  if (options.scene.gravity !== undefined) {
    const gravity = options.scene.gravity;
    system.SetGravity(new Jolt.Vec3(gravity.x, gravity.y, gravity.z));
  }

  /** Engine body index → authored ID. The reverse map never escapes. */
  const idByBodyIndex = new Map<number, string>();
  const triggerIds = new Set<string>();
  const proxyBodies = new Map<string, any>();
  let destroyed = false;

  function assertLive(): void {
    if (destroyed) {
      throw new SpatialWorldError('spatial world has been destroyed');
    }
  }

  function createShape(body: (typeof options.scene.bodies)[number]): any {
    if (body.shape.kind === 'box') {
      const { x, y, z } = body.shape.halfExtents;
      return new Jolt.BoxShape(new Jolt.Vec3(x, y, z), 0.05, null);
    }
    return new Jolt.SphereShape(body.shape.radius);
  }

  // Bodies are added in authored-ID order so engine indices are a deterministic
  // function of the scene, independent of how the caller ordered the array.
  const orderedBodies = [...options.scene.bodies].sort((a, b) => compareText(a.id, b.id));
  for (const descriptor of orderedBodies) {
    const shape = createShape(descriptor);
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
    const body = bodyInterface.CreateBody(creation);
    Jolt.destroy(creation);
    bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);

    idByBodyIndex.set(body.GetID().GetIndexAndSequenceNumber(), descriptor.id);
    if (descriptor.role === 'trigger') {
      triggerIds.add(descriptor.id);
    }
  }

  function resolveSourceId(bodyId: any): string | null {
    return idByBodyIndex.get(bodyId.GetIndexAndSequenceNumber()) ?? null;
  }

  function castRayInternal(query: RayQuery): RayObservation | null {
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
    // Obstacle layer only: sensors cannot swallow a ray, and a proxy cannot
    // occlude itself or another organism.
    const olFilter = new Jolt.SpecifiedObjectLayerFilter(LAYER_OBSTACLE);
    const bodyFilter = new Jolt.BodyFilter();
    const shapeFilter = new Jolt.ShapeFilter();

    system
      .GetNarrowPhaseQuery()
      .CastRay(ray, raySettings, collector, bpFilter, olFilter, bodyFilter, shapeFilter);

    let observation: RayObservation | null = null;
    if (collector.HadHit()) {
      const hit = collector.mHit;
      const sourceId = resolveSourceId(hit.mBodyID);
      if (sourceId !== null) {
        const point = ray.GetPointOnRay(hit.mFraction);
        const body = system.GetBodyLockInterfaceNoLock().TryGetBody(hit.mBodyID);
        const normal = body.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point);
        observation = {
          sourceId,
          distance: f32(hit.mFraction * query.maxDistance),
          point: vec3(point.GetX(), point.GetY(), point.GetZ()),
          normal: vec3(normal.GetX(), normal.GetY(), normal.GetZ()),
        };
      }
    }

    Jolt.destroy(shapeFilter);
    Jolt.destroy(bodyFilter);
    Jolt.destroy(olFilter);
    Jolt.destroy(bpFilter);
    Jolt.destroy(raySettings);
    Jolt.destroy(collector);
    Jolt.destroy(ray);
    return observation;
  }

  function triggersContaining(position: Vec3): string[] {
    const collector = new Jolt.CollidePointAllHitCollisionCollector();
    const point = new Jolt.RVec3(position.x, position.y, position.z);
    const bpFilter = new Jolt.BroadPhaseLayerFilter();
    // Sensor layer only, so obstacles never register as trigger containment.
    const olFilter = new Jolt.SpecifiedObjectLayerFilter(LAYER_SENSOR);
    const bodyFilter = new Jolt.BodyFilter();
    const shapeFilter = new Jolt.ShapeFilter();

    system
      .GetNarrowPhaseQuery()
      .CollidePoint(point, collector, bpFilter, olFilter, bodyFilter, shapeFilter);

    const found: string[] = [];
    const hits = collector.mHits;
    for (let index = 0; index < hits.size(); index += 1) {
      const sourceId = resolveSourceId(hits.at(index).mBodyID);
      if (sourceId !== null && triggerIds.has(sourceId)) {
        found.push(sourceId);
      }
    }

    Jolt.destroy(shapeFilter);
    Jolt.destroy(bodyFilter);
    Jolt.destroy(olFilter);
    Jolt.destroy(bpFilter);
    Jolt.destroy(point);
    Jolt.destroy(collector);
    return found.sort(compareText);
  }

  function proxyPosition(id: string): Vec3 {
    const body = proxyBodies.get(id);
    if (body === undefined) {
      throw new SpatialWorldError(`unknown proxy ${id}`);
    }
    const position = body.GetPosition();
    return vec3(position.GetX(), position.GetY(), position.GetZ());
  }

  return {
    enabled: true,
    initMs,
    get bodyIds() {
      return [...idByBodyIndex.values()].sort(compareText);
    },
    get proxyIds() {
      return [...proxyBodies.keys()].sort(compareText);
    },
    addProxy(descriptor: ProxyDescriptor) {
      assertLive();
      if (proxyBodies.has(descriptor.id)) {
        throw new SpatialWorldError(`proxy ${descriptor.id} already exists`);
      }
      if (!(descriptor.radius > 0)) {
        throw new SpatialWorldError(`proxy ${descriptor.id} radius must be > 0`);
      }
      const shape = new Jolt.SphereShape(descriptor.radius);
      const creation = new Jolt.BodyCreationSettings(
        shape,
        new Jolt.RVec3(descriptor.position.x, descriptor.position.y, descriptor.position.z),
        new Jolt.Quat(0, 0, 0, 1),
        Jolt.EMotionType_Kinematic,
        LAYER_PROXY,
      );
      const body = bodyInterface.CreateBody(creation);
      Jolt.destroy(creation);
      bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
      proxyBodies.set(descriptor.id, body);
      idByBodyIndex.set(body.GetID().GetIndexAndSequenceNumber(), descriptor.id);
    },
    setProxyPosition(id: string, position: Vec3) {
      assertLive();
      const body = proxyBodies.get(id);
      if (body === undefined) {
        throw new SpatialWorldError(`unknown proxy ${id}`);
      }
      // Kinematic teleport: the NCA owns motion, so physics never integrates
      // organism movement and cannot make it read as rigid-body dynamics.
      bodyInterface.SetPosition(
        body.GetID(),
        new Jolt.RVec3(position.x, position.y, position.z),
        Jolt.EActivation_Activate,
      );
    },
    step(deltaSeconds: number) {
      assertLive();
      if (!(deltaSeconds > 0)) {
        throw new SpatialWorldError(`step delta must be > 0 (got ${deltaSeconds})`);
      }
      joltInterface.Step(deltaSeconds, 1);
    },
    observe(proxyId: string): ProxyObservation {
      assertLive();
      const position = proxyPosition(proxyId);
      const bySource = new Map<string, RayObservation>();
      let grounded = false;
      let groundNormal = vec3(0, 1, 0);
      let nearest: RayObservation | null = null;

      for (const direction of PROBE_DIRECTIONS) {
        const hit = castRayInternal({ origin: position, direction, maxDistance: probeRange });
        if (hit === null) {
          continue;
        }
        // Keep the closest hit per source so the list is a set keyed by ID.
        const existing = bySource.get(hit.sourceId);
        if (existing === undefined || hit.distance < existing.distance) {
          bySource.set(hit.sourceId, hit);
        }
        if (nearest === null || hit.distance < nearest.distance) {
          nearest = hit;
        }
        if (direction.y === -1) {
          grounded = true;
          groundNormal = hit.normal;
        }
      }

      const contacts = [...bySource.values()].sort((a, b) => compareText(a.sourceId, b.sourceId));

      return {
        proxyId,
        position,
        grounded,
        groundNormal,
        obstacleDistance: nearest === null ? probeRange : nearest.distance,
        nearestObstacle: nearest,
        contacts,
        triggers: triggersContaining(position),
      };
    },
    castRay(query: RayQuery) {
      assertLive();
      return castRayInternal(query);
    },
    stateHash() {
      assertLive();
      const ids = [...proxyBodies.keys()].sort(compareText);
      const values = new Float32Array(ids.length * 3);
      ids.forEach((id, index) => {
        const position = proxyPosition(id);
        values[index * 3] = position.x;
        values[index * 3 + 1] = position.y;
        values[index * 3 + 2] = position.z;
      });
      return hashState([values], ids.length);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      // The adapter owns every WASM allocation it made; JoltInterface teardown
      // releases the bodies and shapes registered above.
      Jolt.destroy(joltInterface);
      proxyBodies.clear();
      idByBodyIndex.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
