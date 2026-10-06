import { describe, expect, it } from 'vitest';
import weights from '../src/nca/models/branching-m1.weights.json';
import { loadGraphNcaModel } from '../src/nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../src/nca/graph/graphNcaRuntime';
import { vec3 } from '../src/environments/fields';
import { HOME_PRESETS } from '../src/environments/homePresets';
import type { HomePresetManifest } from '../src/environments/homePresets';
import { DEFAULT_LIFECYCLE_RATES, LIFECYCLE_TICK_SECONDS } from '../src/lifecycle';
import { clearance } from '../src/homeSim/homeColliders';
import {
  HOME_BODY_RADIUS,
  HomeWorld,
  SPAWN_CLEARANCE_METERS,
  SPAWN_MAX_FOOD,
  SPAWN_MAX_KILL,
} from '../src/homeSim/homeWorld';
import type { HomeGoalId } from '../src/homeSim/homeWorld';

const model = loadGraphNcaModel(weights as GraphNcaWeightsJson);
const COURTYARD = HOME_PRESETS['courtyard-house'];
const SEED = 1;

/** Pinned M3 signatures for seed 1, courtyard, food goal, at ticks 0, 300 and 900. */
const PINNED_HASHES = { 0: 'ba6992df', 300: 'fe82becd', 900: '545e18fb' } as const;

function world(goal: HomeGoalId = 'food', preset: HomePresetManifest = COURTYARD, seed = SEED) {
  return new HomeWorld(model, preset, seed, { goal });
}

function signatures(preset: HomePresetManifest): Record<number, string> {
  const w = world('food', preset);
  const hashes: Record<number, string> = { 0: w.signature() };
  w.step(300);
  hashes[300] = w.signature();
  w.step(600);
  hashes[900] = w.signature();
  return hashes;
}

/** Steps until the organism stops moving at its goal; returns the tick count used. */
function settle(w: HomeWorld, maxTicks = 1500): void {
  let still = 0;
  let last = w.snapshot();
  for (let tick = 0; tick < maxTicks && (tick < 150 || still < 30); tick += 1) {
    w.step();
    const now = w.snapshot();
    still = Math.hypot(now.x - last.x, now.z - last.z) < 1e-6 ? still + 1 : 0;
    last = now;
  }
}

// Each test runs hundreds of 128-node ticks with per-node field sampling.
describe('M3 Home world (courtyard house)', { timeout: 30_000 }, () => {
  it('spawns with 0.20 m clearance, K ≤ 0.05 and F ≤ 0.10', () => {
    for (const seed of [1, 2, 3, 42, 900001]) {
      const w = world('stay', COURTYARD, seed);
      const { x, z } = w.spawnPoint;
      expect(clearance(w.colliders, x, z, HOME_BODY_RADIUS)).toBeGreaterThanOrEqual(SPAWN_CLEARANCE_METERS);
      for (let node = 0; node < model.nodes; node += 1) {
        const sample = w.provider.sample(vec3(w.positions[node * 3]!, w.positions[node * 3 + 1]!, w.positions[node * 3 + 2]!));
        expect(sample.scalars.danger ?? 0).toBeLessThanOrEqual(SPAWN_MAX_KILL);
        expect(sample.scalars.energy ?? 0).toBeLessThanOrEqual(SPAWN_MAX_FOOD);
      }
    }
  });

  it('feeds at the authored threshold and visibly gains energy', () => {
    const w = world('food');
    settle(w);
    const before = w.snapshot().energy;
    w.step(150);
    const after = w.snapshot();
    expect(after.food).toBeGreaterThan(0.3);
    expect(after.energy).toBeGreaterThan(Math.min(0.99, before + 0.1));
    expect(after.health).toBe(1);
    const feed = w.events.find((event) => event.kind === 'feed');
    expect(feed?.sourceIds).toEqual([COURTYARD.switchableEffectSourceId]);
  });

  it('takes kill exposure at the authored fault, losing health and only nearby nodes', () => {
    const w = world('fault');
    for (let tick = 0; tick < 900 && w.snapshot().health > 0.5; tick += 1) w.step();
    const snapshot = w.snapshot();
    expect(snapshot.health).toBeLessThan(0.9);
    expect(snapshot.danger).toBeGreaterThan(0);
    const lesion = w.events.find((event) => event.kind === 'lesion');
    expect(lesion).toBeDefined();
    const damage = w.events.find((event) => event.kind === 'damage');
    expect(damage?.sourceIds).toEqual(['courtyard-outlet-hazard']);
    // Damage is local: the organism keeps most of its nodes, and every dead node was in danger.
    expect(snapshot.aliveNodes).toBeGreaterThan(model.nodes / 2);
    expect(snapshot.aliveNodes).toBeLessThan(model.nodes);
    for (let node = 0; node < model.nodes; node += 1) {
      if (w.state[node * model.channels]! > model.aliveThreshold) continue;
      expect(w.nodeDanger[node]!).toBeGreaterThan(0.1);
    }
  });

  it('gains energy and loses health under simultaneous food and kill (no cancellation)', () => {
    const fault = COURTYARD.effectSources.find((source) => source.id === 'courtyard-outlet-hazard')!;
    const preset: HomePresetManifest = {
      ...COURTYARD,
      effectSources: [
        ...COURTYARD.effectSources,
        { ...fault, id: 'courtyard-test-feed-at-fault', strength: 0.9, rangeMeters: 1.2 },
      ],
    };
    const w = world('fault', preset);
    let fedWhileDamaged = false;
    for (let tick = 0; tick < 900 && !fedWhileDamaged; tick += 1) {
      const before = w.snapshot();
      w.step();
      const after = w.snapshot();
      if (after.food > 0 && after.danger > 0 && after.energy > before.energy && after.health < before.health) {
        fedWhileDamaged = true;
      }
    }
    expect(fedWhileDamaged).toBe(true);
  });

  it('collides with neutral stair, table and boundaries without touching energy or health', () => {
    for (const goal of ['food', 'fault', 'shelter'] as const) {
      const w = world(goal);
      for (let tick = 0; tick < 700; tick += 1) {
        w.step();
        const s = w.snapshot();
        expect(clearance(w.colliders, s.x, s.z, HOME_BODY_RADIUS)).toBeGreaterThan(-1e-4);
      }
    }
    // On the way to the shelter the organism passes the stair and walls with no field contact.
    const w = world('shelter');
    let previous = w.snapshot();
    for (let tick = 0; tick < 500; tick += 1) {
      w.step();
      const s = w.snapshot();
      if (s.food === 0 && s.danger === 0 && s.shelter === 0 && previous.food === 0 && previous.shelter === 0) {
        const drained = previous.energy - s.energy;
        expect(drained).toBeCloseTo(DEFAULT_LIFECYCLE_RATES.idleDrainPerSecond * LIFECYCLE_TICK_SECONDS, 6);
        expect(s.health).toBe(1);
      }
      previous = s;
    }
  });

  it('reduces idle drain in shelter by 40% × shelter strength and emits no feed', () => {
    const w = world('shelter');
    settle(w);
    const start = w.snapshot();
    w.step(300);
    const end = w.snapshot();
    const shelter = COURTYARD.shelterRegions[0]!.strength;
    expect(end.shelter).toBeCloseTo(shelter, 5);
    const baseline = DEFAULT_LIFECYCLE_RATES.idleDrainPerSecond * LIFECYCLE_TICK_SECONDS * 300;
    expect(start.energy - end.energy).toBeCloseTo(baseline * (1 - 0.4 * shelter), 4);
    expect(end.health).toBe(1);
    expect(w.events.some((event) => event.kind === 'feed')).toBe(false);
  });

  it('a dead organism stays dead and does not regrow', () => {
    const w = world('fault');
    for (let tick = 0; tick < 3000 && w.snapshot().status !== 'dead'; tick += 1) w.step();
    expect(w.snapshot().status).toBe('dead');
    w.setGoal('food');
    w.step(300);
    expect(w.snapshot().aliveNodes).toBe(0);
    expect(w.events.some((event) => event.kind === 'regrow')).toBe(false);
  });

  it('produces identical hashes at ticks 0, 300 and 900, independent of source declaration order', () => {
    const reversed: HomePresetManifest = {
      ...COURTYARD,
      effectSources: [...COURTYARD.effectSources].reverse(),
      shelterRegions: [...COURTYARD.shelterRegions].reverse(),
    };
    const hashes = signatures(COURTYARD);
    expect(hashes).toEqual(PINNED_HASHES);
    expect(signatures(COURTYARD)).toEqual(hashes);
    expect(signatures(reversed)).toEqual(hashes);
  });
});
