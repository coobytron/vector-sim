import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NullSpatialQueryWorld, PORCELAIN_TEST_SCENE } from '../src/physics';
import type { SpatialObservation } from '../src/physics';
import {
  JoltSpatialQueryWorld,
  PROBE_RANGE_METERS,
  SpatialWorldError,
  validateSpatialScene,
} from '../src/physics/joltSpatialQueryWorld';
import type { SpatialSceneDescriptor } from '../src/physics/joltSpatialQueryWorld';
import { loadJolt } from '../src/physics/joltLoader';

function sourceIds(observations: readonly SpatialObservation[]): string[] {
  return observations.map((observation) => observation.sourceId);
}

describe('scene validation', () => {
  it('accepts the porcelain test scene', () => {
    expect(() => validateSpatialScene(PORCELAIN_TEST_SCENE)).not.toThrow();
    expect(PORCELAIN_TEST_SCENE.bodies.length).toBeGreaterThan(4);
  });

  it('rejects duplicates, bad roles, and degenerate shapes', () => {
    const base = PORCELAIN_TEST_SCENE.bodies[0] as SpatialSceneDescriptor['bodies'][number];
    expect(() => validateSpatialScene({ id: '', bodies: [] })).toThrow(SpatialWorldError);
    expect(() => validateSpatialScene({ id: 's', bodies: [base, base] })).toThrow(/duplicate body id/);
    expect(() =>
      validateSpatialScene({ id: 's', bodies: [{ ...base, id: 'x', role: 'wall' as never }] }),
    ).toThrow(/invalid role/);
    expect(() =>
      validateSpatialScene({
        id: 's',
        bodies: [
          { id: 'x', role: 'obstacle', shape: { kind: 'sphere', radius: 0 }, position: { x: 0, y: 0, z: 0 } },
        ],
      }),
    ).toThrow(/radius must be > 0/);
  });
});

describe('null world (PR #38 fallback)', () => {
  it('stays operational and senses nothing', () => {
    const world = new NullSpatialQueryWorld();
    expect(world.kind).toBe('null');
    expect(world.ready).toBe(true);
    expect(world.raycast({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 5 })).toEqual([]);
    expect(world.overlapSphere({ center: { x: 0, y: 0, z: 0 }, radius: 1 })).toEqual([]);
    world.step(1 / 30);
    world.dispose();
  });
});

describe('jolt spatial-query world', () => {
  let world: JoltSpatialQueryWorld;

  beforeAll(async () => {
    world = await JoltSpatialQueryWorld.create({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
  });

  afterAll(() => {
    world.dispose();
  });

  it('satisfies the shared contract', () => {
    expect(world.kind).toBe('jolt');
    expect(world.ready).toBe(true);
    expect(typeof world.raycast).toBe('function');
    expect(typeof world.overlapSphere).toBe('function');
    expect(typeof world.step).toBe('function');
    expect(typeof world.dispose).toBe('function');
  });

  it('registers every authored body and exposes no engine handles', () => {
    expect(world.bodyIds).toEqual([
      'alcove-volume',
      'floor',
      'stair-block',
      'table',
      'threshold-volume',
      'wall-north',
      'wall-west',
    ]);
  });

  it('raycasts onto the floor with an authored ID, point, and normal', () => {
    const hits = world.raycast({
      origin: { x: 0, y: 2, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('ray-hit');
    expect(hits[0]?.sourceId).toBe('floor');
    expect(hits[0]?.point?.y).toBeCloseTo(0, 2);
    expect(hits[0]?.normal?.y).toBeCloseTo(1, 3);
    expect(hits[0]?.distance).toBeCloseTo(2, 2);
  });

  it('returns an empty list when nothing is in range', () => {
    expect(
      world.raycast({ origin: { x: 0, y: 2, z: 0 }, direction: { x: 0, y: 1, z: 0 }, maxDistance: 1 }),
    ).toEqual([]);
  });

  it('rejects a zero-length ray direction', () => {
    expect(() =>
      world.raycast({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: 0 }, maxDistance: 1 }),
    ).toThrow(SpatialWorldError);
  });

  it('keeps trigger volumes out of the obstacle ray path', () => {
    // A sensor must not block a ray; the floor below it is still the hit.
    const hits = world.raycast({
      origin: { x: 2.7, y: 1.5, z: 0.55 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 2,
    });
    expect(hits[0]?.sourceId).toBe('floor');
  });

  it('reports trigger volumes through overlapSphere with a role tag', () => {
    const overlaps = world.overlapSphere({ center: { x: 2.7, y: 0.35, z: 0.55 }, radius: 0.1 });
    const triggers = overlaps.filter((hit) => hit.metadata?.role === 'trigger');
    expect(sourceIds(triggers)).toEqual(['threshold-volume']);
    expect(triggers[0]?.kind).toBe('overlap');
  });

  it('senses ground and obstacles through a proxy', () => {
    world.addProxy({ id: 'organism-a', radius: 0.12, position: { x: 0, y: 0.4, z: 0 } });
    world.step(1 / 30);

    const observations = world.observeProxy('organism-a');
    const floor = observations.find((hit) => hit.sourceId === 'floor');
    expect(floor).toBeDefined();
    expect(floor?.distance).toBeCloseTo(0.4, 2);
    expect(floor?.normal?.y).toBeCloseTo(1, 3);
    expect(observations.every((hit) => hit.sourceId !== 'organism-a')).toBe(true);
  });

  it('returns proxy observations in normalized order', () => {
    world.addProxy({ id: 'organism-corner', radius: 0.05, position: { x: -3.0, y: 0.2, z: 0 } });
    world.step(1 / 30);
    const ids = sourceIds(world.observeProxy('organism-corner'));
    expect([...ids].sort()).toEqual(ids);
  });

  it('moves a proxy and re-senses at the new position', () => {
    world.addProxy({ id: 'organism-mobile', radius: 0.05, position: { x: 0, y: 1.5, z: 0 } });
    world.step(1 / 30);
    expect(world.observeProxy('organism-mobile')).toEqual([]);

    world.setProxyPosition('organism-mobile', { x: 2.7, y: 0.35, z: 0.55 });
    world.step(1 / 30);
    const triggers = world
      .observeProxy('organism-mobile')
      .filter((hit) => hit.metadata?.role === 'trigger');
    expect(sourceIds(triggers)).toEqual(['threshold-volume']);
  });

  it('rejects unknown and duplicate proxies', () => {
    expect(() => world.setProxyPosition('nope', { x: 0, y: 0, z: 0 })).toThrow(/unknown proxy/);
    world.addProxy({ id: 'dupe', radius: 0.05, position: { x: 0, y: 3, z: 0 } });
    expect(() => world.addProxy({ id: 'dupe', radius: 0.05, position: { x: 0, y: 3, z: 0 } })).toThrow(
      /already exists/,
    );
  });

  it('disposes explicitly and refuses later queries', async () => {
    const disposable = await JoltSpatialQueryWorld.create({
      scene: PORCELAIN_TEST_SCENE,
      loadJolt: () => loadJolt(),
    });
    disposable.addProxy({ id: 'a', radius: 0.1, position: { x: 0, y: 1, z: 0 } });
    disposable.dispose();

    expect(disposable.ready).toBe(false);
    expect(() => disposable.observeProxy('a')).toThrow(/disposed/);
    expect(() => disposable.step(1 / 30)).toThrow(/disposed/);
    disposable.dispose(); // idempotent
  });
});

describe('jolt determinism', () => {
  const reversed: SpatialSceneDescriptor = {
    ...PORCELAIN_TEST_SCENE,
    bodies: [...PORCELAIN_TEST_SCENE.bodies].reverse(),
  };

  async function runScenario(scene: SpatialSceneDescriptor): Promise<{
    hash: string;
    observations: string;
  }> {
    const world = await JoltSpatialQueryWorld.create({ scene, loadJolt: () => loadJolt() });
    world.addProxy({ id: 'organism-a', radius: 0.12, position: { x: 0, y: 0.6, z: 0 } });
    world.addProxy({ id: 'organism-b', radius: 0.08, position: { x: 2.7, y: 0.35, z: 0.55 } });

    const path = [
      { x: 0, y: 0.5, z: 0 },
      { x: -2.5, y: 0.4, z: 0.5 },
      { x: 0.8, y: 0.95, z: -0.6 },
      { x: 2.7, y: 0.35, z: 0.55 },
    ];
    const captured: string[] = [];
    for (const position of path) {
      world.setProxyPosition('organism-a', position);
      for (let tick = 0; tick < 5; tick += 1) {
        world.step(1 / 30);
      }
      for (const proxyId of world.proxyIds) {
        captured.push(
          JSON.stringify({
            proxyId,
            observations: world.observeProxy(proxyId).map((hit) => ({
              kind: hit.kind,
              sourceId: hit.sourceId,
              distance: hit.distance.toFixed(4),
            })),
          }),
        );
      }
    }

    const result = { hash: world.stateHash(), observations: captured.join('\n') };
    world.dispose();
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

  it('probe range is the documented default', () => {
    expect(PROBE_RANGE_METERS).toBe(1);
  });
});
