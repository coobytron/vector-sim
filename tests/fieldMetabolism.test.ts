import { describe, expect, it } from 'vitest';
import type { EnvironmentManifest, FieldSourceDescriptor } from '../src/fields/types';
import { createFieldSample } from '../src/fields/types';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';

/**
 * The spawn volume sits well clear of the floor, and test sources are authored
 * to cover it so every cell of the seeded population shares one exposure.
 */
const SPAWN_CENTER: [number, number, number] = [0, 1, 0];

function testManifest(sources: FieldSourceDescriptor[]): EnvironmentManifest {
  return {
    schemaVersion: 'environment.v1',
    id: 'metabolism-fixture',
    displayName: 'Metabolism Fixture',
    units: 'meters',
    coordinateSystem: 'right-handed-y-up',
    bounds: { min: [-6, -2, -6], max: [6, 6, 6] },
    assets: [],
    sources,
    spawnRegions: [
      {
        id: 'fixture-spawn',
        volume: { kind: 'box', center: SPAWN_CENTER, halfExtents: [0.3, 0.2, 0.3] },
        capacity: 8,
      },
    ],
    cameraPresets: [
      {
        id: 'fixture-hero',
        target: [0, 1, 0],
        position: [3, 3, 3],
        verticalFovDegrees: 42,
        nearMeters: 0.05,
        farMeters: 40,
        safeBounds: { min: [-6, -2, -6], max: [6, 6, 6] },
        fallbackInput: 'pointer',
      },
    ],
    looks: ['porcelain-spectrum', 'technical-wire', 'ghost-volume'],
    qualityTiers: ['mobile', 'desktop'],
  };
}

/**
 * A source large enough to cover the whole seeded population. It is authored
 * silent because the spawn contract forbids seeding inside live exposure; tests
 * switch it on afterwards through the same runtime hook field painting uses.
 */
function blanket(id: string, range = 3): FieldSourceDescriptor {
  return {
    id,
    geometry: { kind: 'box', center: [0, 1.6, 0], halfExtents: [1.5, 1.2, 1.5] },
    channels: { effect: { strength: 0, rangeMeters: range } },
  };
}

interface RunOptions {
  sources?: FieldSourceDescriptor[];
  activate?: Record<string, number>;
  seed?: number;
}

function start(options: RunOptions = {}): HeadlessSimulation {
  const simulation = new HeadlessSimulation({
    tier: QUALITY_TIERS.mobile,
    seed: options.seed ?? 21,
    manifest: testManifest(options.sources ?? []),
  });
  for (const [id, strength] of Object.entries(options.activate ?? {})) {
    simulation.fields.setStrength(id, strength);
  }
  return simulation;
}

function run(options: RunOptions, ticks: number): HeadlessSimulation {
  const simulation = start(options);
  for (let tick = 0; tick < ticks; tick += 1) simulation.step();
  return simulation;
}

function meanEnergy(simulation: HeadlessSimulation): number {
  let total = 0;
  for (let cell = 0; cell < simulation.nodeCount; cell += 1) total += simulation.energy[cell] ?? 0;
  return total / simulation.nodeCount;
}

function meanHealth(simulation: HeadlessSimulation): number {
  let total = 0;
  for (let cell = 0; cell < simulation.nodeCount; cell += 1) total += simulation.health[cell] ?? 0;
  return total / simulation.nodeCount;
}

function activeCount(simulation: HeadlessSimulation): number {
  let total = 0;
  for (let cell = 0; cell < simulation.nodeCount; cell += 1) total += simulation.active[cell] ?? 0;
  return total;
}

describe('field-driven metabolism', () => {
  it('leaves health untouched and only idles energy down in a neutral environment', () => {
    const neutral = run(
      {
        sources: [
          {
            id: 'shelf',
            geometry: { kind: 'box', center: [0, -1, 0], halfExtents: [3, 0.1, 3] },
            channels: { obstacle: true },
          },
        ],
      },
      90,
    );
    expect(meanHealth(neutral)).toBe(1);
    expect(activeCount(neutral)).toBe(neutral.nodeCount);
    // Three seconds of idle drain at 0.012/s from the 0.65 spawn energy.
    expect(meanEnergy(neutral)).toBeLessThan(0.65);
    expect(meanEnergy(neutral)).toBeGreaterThan(0.55);
  });

  it('restores energy from a positive source', () => {
    const fed = run({ sources: [blanket('feed')], activate: { feed: 1 } }, 90);
    const neutral = run({}, 90);
    expect(meanEnergy(fed)).toBeGreaterThan(meanEnergy(neutral));
    expect(meanEnergy(fed)).toBeGreaterThan(0.65);
  });

  it('feeds and damages simultaneously under equal food and kill exposure', () => {
    const both = run(
      { sources: [blanket('feed'), blanket('hazard')], activate: { feed: 1, hazard: -1 } },
      60,
    );
    const sample = createFieldSample();
    both.fields.sample(SPAWN_CENTER[0], SPAWN_CENTER[1], SPAWN_CENTER[2], sample);
    expect(sample.food).toBeCloseTo(sample.kill, 5);
    expect(sample.effect).toBeCloseTo(0, 5);

    // Net effect is zero, yet energy rose and health fell.
    expect(meanEnergy(both)).toBeGreaterThan(0.65);
    expect(meanHealth(both)).toBeLessThan(1);
  });

  it('crosses a deterministic death threshold under sustained kill exposure', () => {
    const dying = run({ sources: [blanket('hazard')], activate: { hazard: -1 } }, 120);
    expect(meanHealth(dying)).toBe(0);
    expect(activeCount(dying)).toBe(0);

    const survivor = run({ sources: [blanket('hazard')], activate: { hazard: -0.02 } }, 120);
    expect(activeCount(survivor)).toBe(survivor.nodeCount);
  });

  it('reverses a source effect from agent-side code that never changed', () => {
    const simulation = start({ sources: [blanket('threshold')], activate: { threshold: 1 } });
    for (let tick = 0; tick < 60; tick += 1) simulation.step();
    expect(meanEnergy(simulation)).toBeGreaterThan(0.65);
    expect(meanHealth(simulation)).toBe(1);

    simulation.fields.setStrength('threshold', -1);
    for (let tick = 0; tick < 60; tick += 1) simulation.step();
    expect(meanHealth(simulation)).toBeLessThan(1);
  });

  it('reduces idle drain inside a shelter', () => {
    const sheltered = run(
      {
        sources: [
          {
            id: 'alcove',
            geometry: { kind: 'box', center: [0, 1, 0], halfExtents: [2, 2, 2] },
            channels: { shelter: 1 },
          },
        ],
      },
      120,
    );
    const exposed = run({}, 120);
    expect(meanEnergy(sheltered)).toBeGreaterThan(meanEnergy(exposed));
  });

  it('exhausts a finite reserve and stops feeding', () => {
    const simulation = start({
      sources: [
        {
          id: 'small-feed',
          geometry: { kind: 'box', center: [0, 1.6, 0], halfExtents: [1.5, 1.2, 1.5] },
          channels: {
            effect: {
              strength: 0,
              rangeMeters: 3,
              reserve: { capacity: 0.5, regenerationPerSecond: 0 },
            },
          },
        },
      ],
      activate: { 'small-feed': 1 },
    });
    const source = simulation.fields.sourceById('small-feed');
    expect(source?.reserve).toBe(0.5);
    for (let tick = 0; tick < 60; tick += 1) simulation.step();
    expect(source?.reserve).toBe(0);

    const exhausted = meanEnergy(simulation);
    for (let tick = 0; tick < 30; tick += 1) simulation.step();
    // With the reserve empty the source no longer feeds, so idle drain wins.
    expect(meanEnergy(simulation)).toBeLessThan(exhausted);
  });
});

describe('flow, collision, and determinism', () => {
  it('transports cells without changing energy or health', () => {
    const still = run({}, 60);
    const flowing = run(
      {
        sources: [
          {
            id: 'current',
            geometry: { kind: 'box', center: [0, 1, 0], halfExtents: [2, 2, 2] },
            channels: { flow: [0.8, 0, 0] },
          },
        ],
      },
      60,
    );

    expect(meanEnergy(flowing)).toBeCloseTo(meanEnergy(still), 6);
    expect(meanHealth(flowing)).toBeCloseTo(meanHealth(still), 6);

    let movedFurther = 0;
    for (let cell = 0; cell < still.nodeCount; cell += 1) {
      const offset = cell * 3;
      if ((flowing.snapshot.positions[offset] ?? 0) > (still.snapshot.positions[offset] ?? 0)) {
        movedFurther += 1;
      }
    }
    expect(movedFurther).toBe(still.nodeCount);
  });

  it('resolves obstacle penetration without adding kinetic energy', () => {
    const simulation = start({
      sources: [
        // The slab clears the spawn volume; the downdraft drives cells into it.
        {
          id: 'floor-slab',
          geometry: { kind: 'box', center: [0, 0.3, 0], halfExtents: [2, 0.15, 2] },
          channels: { obstacle: true },
        },
        {
          id: 'downdraft',
          geometry: { kind: 'box', center: [0, 1.2, 0], halfExtents: [2, 1.5, 2] },
          channels: { flow: [0, -0.9, 0] },
        },
      ],
    });

    const sample = createFieldSample();
    for (let tick = 0; tick < 90; tick += 1) {
      const before = Float32Array.from(simulation.snapshot.velocities);
      simulation.step();
      const after = simulation.snapshot.velocities;
      for (let cell = 0; cell < simulation.nodeCount; cell += 1) {
        if (simulation.active[cell] !== 1) continue;
        const offset = cell * 3;
        simulation.fields.sample(
          simulation.snapshot.positions[offset] ?? 0,
          simulation.snapshot.positions[offset + 1] ?? 0,
          simulation.snapshot.positions[offset + 2] ?? 0,
          sample,
        );
        // Nothing is left inside the slab.
        expect(sample.obstacleDistance).toBeGreaterThan(-0.002);

        if (sample.obstacleDistance > 0.05) continue;
        const speedBefore = Math.hypot(
          before[offset] ?? 0,
          before[offset + 1] ?? 0,
          before[offset + 2] ?? 0,
        );
        const speedAfter = Math.hypot(
          after[offset] ?? 0,
          after[offset + 1] ?? 0,
          after[offset + 2] ?? 0,
        );
        // Contact never speeds a cell up beyond what the tick's own forces did.
        expect(speedAfter).toBeLessThan(speedBefore + 0.35);
      }
    }
  });

  it('produces the same tick hash regardless of source declaration order', () => {
    const sources = [
      blanket('feed'),
      blanket('hazard'),
      {
        id: 'floor',
        geometry: { kind: 'box', center: [0, -1, 0], halfExtents: [3, 0.1, 3] },
        channels: { obstacle: true },
      } satisfies FieldSourceDescriptor,
    ];

    const forward = start({ sources, seed: 5, activate: { feed: 0.6, hazard: -0.2 } });
    const reversed = start({
      sources: [...sources].reverse(),
      seed: 5,
      activate: { hazard: -0.2, feed: 0.6 },
    });

    for (let tick = 0; tick < 120; tick += 1) {
      forward.step();
      reversed.step();
    }
    expect(reversed.stateHash()).toBe(forward.stateHash());
  });

  it('keeps field and lifecycle semantics identical across quality tiers', () => {
    const manifest = testManifest([blanket('feed')]);
    const mobile = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 3, manifest });
    const desktop = new HeadlessSimulation({ tier: QUALITY_TIERS.desktop, seed: 3, manifest });
    mobile.fields.setStrength('feed', 0.8);
    desktop.fields.setStrength('feed', 0.8);
    for (let tick = 0; tick < 60; tick += 1) {
      mobile.step();
      desktop.step();
    }
    // Different capacity, same rules: both tiers feed and neither takes damage.
    expect(meanEnergy(mobile)).toBeGreaterThan(0.65);
    expect(meanEnergy(desktop)).toBeGreaterThan(0.65);
    expect(meanHealth(mobile)).toBe(1);
    expect(meanHealth(desktop)).toBe(1);
  });

  it('fails visibly when a spawn region cannot satisfy the contract', () => {
    expect(
      () =>
        new HeadlessSimulation({
          tier: QUALITY_TIERS.mobile,
          seed: 1,
          manifest: testManifest([
            {
              id: 'pillar',
              geometry: { kind: 'box', center: SPAWN_CENTER, halfExtents: [1, 1, 1] },
              channels: { obstacle: true },
            },
          ]),
        }),
    ).toThrow(/spawn/i);
  });
});
