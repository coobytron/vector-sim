import { vec3 } from '../environments/fields';
import type { Vec3 } from '../environments/fields';
import { PROBE_RANGE_METERS, SpatialWorldError, validateScene } from './types';
import type {
  ProxyDescriptor,
  ProxyObservation,
  SceneDescriptor,
  SpatialQueryWorld,
} from './types';

const UP: Vec3 = vec3(0, 1, 0);

/**
 * The adapter-disabled world.
 *
 * Every query answers "nothing sensed": no ground, no obstacle inside the probe
 * range, no triggers. This is what keeps the headless simulation operational
 * with physics switched off, and it is the control case the Jolt world is
 * compared against.
 */
export function createNullSpatialWorld(scene?: SceneDescriptor): SpatialQueryWorld {
  if (scene !== undefined) {
    validateScene(scene);
  }
  const proxies = new Map<string, Vec3>();

  function mustGet(id: string): Vec3 {
    const position = proxies.get(id);
    if (position === undefined) {
      throw new SpatialWorldError(`unknown proxy ${id}`);
    }
    return position;
  }

  return {
    enabled: false,
    get bodyIds() {
      return [];
    },
    get proxyIds() {
      return [...proxies.keys()].sort();
    },
    addProxy(descriptor: ProxyDescriptor) {
      if (proxies.has(descriptor.id)) {
        throw new SpatialWorldError(`proxy ${descriptor.id} already exists`);
      }
      proxies.set(descriptor.id, vec3(descriptor.position.x, descriptor.position.y, descriptor.position.z));
    },
    setProxyPosition(id: string, position: Vec3) {
      mustGet(id);
      proxies.set(id, vec3(position.x, position.y, position.z));
    },
    step() {
      // Nothing moves without an engine; positions are caller-driven.
    },
    observe(proxyId: string): ProxyObservation {
      return {
        proxyId,
        position: mustGet(proxyId),
        grounded: false,
        groundNormal: UP,
        obstacleDistance: PROBE_RANGE_METERS,
        nearestObstacle: null,
        contacts: [],
        triggers: [],
      };
    },
    castRay() {
      return null;
    },
    stateHash() {
      return '00000000';
    },
    destroy() {
      proxies.clear();
    },
  };
}
