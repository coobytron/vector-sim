import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vec3 } from '../src/environments/fields';
import {
  PORCELAIN_TEST_SCENE,
  PROBE_RANGE_METERS,
  SPATIAL_CHANNELS,
  SpatialWorldError,
  createNullSpatialWorld,
  createSpatialFieldProvider,
  normalizeObservation,
  validateScene,
} from '../src/physics';
import type { ProxyObservation, SceneDescriptor, SpatialQueryWorld } from '../src/physics';
import { createJoltSpatialWorld } from '../src/physics/joltWorld';
import { loadJolt } from '../src/physics/joltLoader';

describe('scene validation', () => {
  it('accepts the porcelain test scene', () => {
    expect(() => validateScene(PORCELAIN_TEST_SCENE)).not.toThrow();
    expect(PORCELAIN_TEST_SCENE.bodies.length).toBeGreaterThan(4);
  });

  it('rejects duplicates, bad roles, and degenerate shapes', () => {
    const base = PORCELAIN_TEST_SCENE.bodies[0] as SceneDescriptor['bodies'][number];
    expect(() => validateScene({ id: '', bodies: [] })).toThrow(SpatialWorldError);
    expect(() => validateScene({ id: 's', bodies: [base, base] })).toThrow(/duplicate body id/);
    expect(() =>
      validateScene({ id: 's', bodies: [{ ...base, id: 'x', role: 'wall' as never }] }),
    ).toThrow(/invalid role/);
    expect(() =>
      validateScene({
        id: 's',
        bodies: [{ id: 'x', role: 'obstacle', shape: { kind: 'sphere', radius: 0 }, position: vec3(0, 0, 0) }],
      }),
    ).toThrow(/radius must be > 0/);
    expect(() =>
      validateScene({
        id: 's',
        bodies: [
          { id: 'x', role: 'obstacle', shape: { kind: 'box', halfExtents: vec3(1, 0, 1) }, position: vec3(0, 0, 0) },
        ],
      }),
    ).toThrow(/halfExtents/);
  });
});

describe('null world (adapter disabled)', () => {
  it('stays operational and senses nothing', () => {
    const world = createNullSpatialWorld(PORCELAIN_TEST_SCENE);
    world.addProxy({ id: 'organism-a', radius: 0.2, position: vec3(0, 1, 0) });

    expect(world.enabled).toBe(false);
    expect(world.bodyIds).toEqual([]);
    expect(world.proxyIds).toEqual(['organism-a']);

    world.step(1 / 30);
    const observation = world.observe('organism-a');
    expect(observation.grounded).toBe(false);
    expect(observation.contacts).toEqual([]);
    expect(observation.triggers).toEqual([]);
    expect(observation.obstacleDistance).toBe(PROBE_RANGE_METERS);
    expect(world.castRay({ origin: vec3(0, 1, 0), direction: vec3(0, -1, 0), maxDistance: 5 })).toBeNull();

    world.setProxyPosition('organism-a', vec3(1, 1, 1));
    expect(world.observe('organism-a').position).toEqual(vec3(1, 1, 1));
    expect(() => world.observe('missing')).toThrow(SpatialWorldError);
    world.destroy();
  });

  it('feeds the shared provider contract with neutral values', () => {
    const world = createNullSpatialWorld();
    world.addProxy({ id: 'a', radius: 0.2, position: vec3(0, 1, 0) });
    const provider = createSpatialFieldProvider(world, 'a');

    const sample = provider.sample(vec3(0, 1, 0));
    expect(sample.scalars[SPATIAL_CHANNELS.grounded]).toBe(0);
    expect(sample.scalars[SPATIAL_CHANNELS.obstacleDistance]).toBe(1);
    expect(sample.sourceIds).toEqual([]);
  });
});

describe('observation normalization', () => {
  const observation: ProxyObservation = {
    proxyId: 'a',
    position: vec3(0, 1, 0),
    grounded: true,
    groundNormal: vec3(0, 1, 0),
    obstacleDistance: 0.25,
    nearestObstacle: {
      sourceId: 'floor',
      distance: 0.25,
      point: vec3(0, 0.75, 0),
      normal: vec3(0, 1, 0),
    },
    contacts: [
      { sourceId: 'floor', distance: 0.25, point: vec3(0, 0.75, 0), normal: vec3(0, 1, 0) },
      { sourceId: 'wall-west', distance: 0.6, point: vec3(-0.6, 1, 0), normal: vec3(1, 0, 0) },
    ],
    triggers: ['alcove-volume'],
  };

  it('normalizes distance over the probe range and points at the obstacle', () => {
    const normalized = normalizeObservation(observation);
    expect(normalized.scalars[SPATIAL_CHANNELS.grounded]).toBe(1);
    expect(normalized.scalars[SPATIAL_CHANNELS.obstacleDistance]).toBeCloseTo(0.25, 6);
    expect(normalized.vectors[SPATIAL_CHANNELS.obstacleDirection]).toEqual(vec3(0, -1, 0));
    expect(normalized.vectors[SPATIAL_CHANNELS.groundNormal]).toEqual(vec3(0, 1, 0));
  });

  it('merges contacts and triggers into one ascending source list', () => {
    expect(normalizeObservation(observation).sourceIds).toEqual([
      'alcove-volume',
      'floor',
      'wall-west',
    ]);
  });

  it('is a pure function of the observation', () => {
    expect(normalizeObservation(observation)).toEqual(normalizeObservation(observation));
  });

  it('reports a zero bearing when nothing is in range', () => {
    const empty: ProxyObservation = {
      ...observation,
      obstacleDistance: PROBE_RANGE_METERS,
      nearestObstacle: null,
      contacts: [],
      triggers: [],
    };
    const normalized = normalizeObservation(empty);
    expect(normalized.vectors[SPATIAL_CHANNELS.obstacleDirection]).toEqual(vec3(0, 0, 0));
    expect(normalized.scalars[SPATIAL_CHANNELS.obstacleDistance]).toBe(1);
  });
});

describe('jolt-backed world', () => {
  let world: SpatialQueryWorld & { readonly initMs: number };

  beforeAll(async () => {
    world = await createJoltSpatialWorld({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
  });

  afterAll(() => {
    world.destroy();
  });

  it('registers every authored body and exposes no engine handles', () => {
    expect(world.enabled).toBe(true);
    expect(world.bodyIds).toEqual([
      'alcove-volume',
      'floor',
      'stair-block',
      'table',
      'threshold-volume',
      'wall-north',
      'wall-west',
    ]);
    for (const id of world.bodyIds) {
      expect(typeof id).toBe('string');
    }
  });

  it('casts a ray onto the floor and returns an authored ID, point, and normal', () => {
    const hit = world.castRay({ origin: vec3(0, 2, 0), direction: vec3(0, -1, 0), maxDistance: 5 });
    expect(hit).not.toBeNull();
    expect(hit?.sourceId).toBe('floor');
    expect(hit?.point.y).toBeCloseTo(0, 2);
    expect(hit?.normal.y).toBeCloseTo(1, 3);
    expect(hit?.distance).toBeCloseTo(2, 2);
  });

  it('misses when nothing is within range', () => {
    expect(
      world.castRay({ origin: vec3(0, 2, 0), direction: vec3(0, 1, 0), maxDistance: 1 }),
    ).toBeNull();
  });

  it('rejects a zero-length ray direction', () => {
    expect(() =>
      world.castRay({ origin: vec3(0, 1, 0), direction: vec3(0, 0, 0), maxDistance: 1 }),
    ).toThrow(SpatialWorldError);
  });

  it('senses ground and obstacle proximity through a proxy', () => {
    world.addProxy({ id: 'organism-a', radius: 0.12, position: vec3(0, 0.4, 0) });
    world.step(1 / 30);

    const observation = world.observe('organism-a');
    expect(observation.grounded).toBe(true);
    expect(observation.groundNormal.y).toBeCloseTo(1, 3);
    expect(observation.obstacleDistance).toBeCloseTo(0.4, 2);
    expect(observation.nearestObstacle?.sourceId).toBe('floor');
    expect(observation.contacts.map((contact) => contact.sourceId)).toContain('floor');
  });

  it('reports trigger volumes by authored ID', () => {
    world.addProxy({ id: 'organism-trigger', radius: 0.05, position: vec3(2.7, 0.35, 0.55) });
    world.step(1 / 30);
    expect(world.observe('organism-trigger').triggers).toEqual(['threshold-volume']);

    world.setProxyPosition('organism-trigger', vec3(0, 1.5, 0));
    world.step(1 / 30);
    expect(world.observe('organism-trigger').triggers).toEqual([]);
  });

  it('keeps trigger volumes out of the obstacle path', () => {
    // A sensor must not block a ray or register as an obstacle contact.
    const hit = world.castRay({
      origin: vec3(2.7, 1.5, 0.55),
      direction: vec3(0, -1, 0),
      maxDistance: 2,
    });
    expect(hit?.sourceId).toBe('floor');
  });

  it('returns contacts in ascending source-ID order', () => {
    world.addProxy({ id: 'organism-corner', radius: 0.05, position: vec3(-3.0, 0.2, 0) });
    world.step(1 / 30);
    const ids = world.observe('organism-corner').contacts.map((contact) => contact.sourceId);
    expect([...ids].sort()).toEqual(ids);
  });

  it('throws after destroy', async () => {
    const disposable = await createJoltSpatialWorld({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
    disposable.addProxy({ id: 'a', radius: 0.1, position: vec3(0, 1, 0) });
    disposable.destroy();
    expect(() => disposable.observe('a')).toThrow(/destroyed/);
    expect(() => disposable.step(1 / 30)).toThrow(/destroyed/);
    disposable.destroy(); // idempotent
  });
});

describe('jolt determinism', () => {
  const reversed: SceneDescriptor = {
    ...PORCELAIN_TEST_SCENE,
    bodies: [...PORCELAIN_TEST_SCENE.bodies].reverse(),
  };

  async function runScenario(scene: SceneDescriptor): Promise<{
    hash: string;
    observations: string;
  }> {
    const world = await createJoltSpatialWorld({ scene, loadJolt: () => loadJolt() });
    world.addProxy({ id: 'organism-a', radius: 0.12, position: vec3(0, 0.6, 0) });
    world.addProxy({ id: 'organism-b', radius: 0.08, position: vec3(2.7, 0.35, 0.55) });

    const path = [vec3(0, 0.5, 0), vec3(-2.5, 0.4, 0.5), vec3(0.8, 0.95, -0.6), vec3(2.7, 0.35, 0.55)];
    const captured: string[] = [];
    for (const position of path) {
      world.setProxyPosition('organism-a', position);
      for (let tick = 0; tick < 5; tick += 1) {
        world.step(1 / 30);
      }
      for (const proxyId of world.proxyIds) {
        const observation = world.observe(proxyId);
        captured.push(
          JSON.stringify({
            proxyId,
            grounded: observation.grounded,
            contacts: observation.contacts.map((contact) => contact.sourceId),
            triggers: observation.triggers,
            distance: observation.obstacleDistance.toFixed(4),
          }),
        );
      }
    }

    const result = { hash: world.stateHash(), observations: captured.join('\n') };
    world.destroy();
    return result;
  }

  it('repeats identically across runs', async () => {
    const first = await runScenario(PORCELAIN_TEST_SCENE);
    const second = await runScenario(PORCELAIN_TEST_SCENE);
    expect(second.hash).toBe(first.hash);
    expect(second.observations).toBe(first.observations);
  });

  it('is independent of scene declaration order', async () => {
    const forward = await runScenario(PORCELAIN_TEST_SCENE);
    const backward = await runScenario(reversed);
    expect(backward.hash).toBe(forward.hash);
    expect(backward.observations).toBe(forward.observations);
  });
});
