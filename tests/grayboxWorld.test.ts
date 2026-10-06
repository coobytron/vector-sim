import { describe, expect, it } from 'vitest';
import weights from '../src/nca/models/branching-m1.weights.json';
import { loadGraphNcaModel } from '../src/nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../src/nca/graph/graphNcaRuntime';
import { DEFAULT_GRAYBOX_LAYOUT, GrayboxWorld } from '../src/graybox/grayboxWorld';

const model = loadGraphNcaModel(weights as GraphNcaWeightsJson);
const SEED = 1;

/** Pinned M2 exit-test signatures for seed 1 at ticks 0, 300 and 900. */
const PINNED_HASHES = { 0: '6006da8b', 300: 'f5ff3655', 900: '1cb16a10' } as const;

function signaturesAt(seed: number): Record<number, string> {
  const world = new GrayboxWorld(model, seed);
  const hashes: Record<number, string> = { 0: world.signature() };
  world.step(300);
  hashes[300] = world.signature();
  world.step(600);
  hashes[900] = world.signature();
  return hashes;
}

describe('M2 graybox loop', () => {
  it('produces identical state hashes at ticks 0, 300 and 900 for a fixed seed', () => {
    expect(signaturesAt(SEED)).toEqual(PINNED_HASHES);
    expect(signaturesAt(SEED)).toEqual(PINNED_HASHES);
  });

  it('changes the run when the seed changes', () => {
    expect(signaturesAt(SEED + 1)[300]).not.toBe(PINNED_HASHES[300]);
  });

  it('passes Gate B: spawns, takes damage, feeds and regrows in order within 900 ticks', () => {
    const world = new GrayboxWorld(model, SEED);
    const { room, obstacle } = DEFAULT_GRAYBOX_LAYOUT;
    let grown = false;
    let fewestAliveAfterGrowth = model.nodes;
    for (let tick = 0; tick < 900; tick += 1) {
      world.step();
      const snapshot = world.snapshot();
      if (snapshot.aliveNodes === model.nodes) grown = true;
      if (grown) fewestAliveAfterGrowth = Math.min(fewestAliveAfterGrowth, snapshot.aliveNodes);
      // The organism root never enters the neutral obstacle or leaves the room.
      const insideObstacle = snapshot.x > obstacle.minX && snapshot.x < obstacle.maxX
        && snapshot.z > obstacle.minZ && snapshot.z < obstacle.maxZ;
      expect(insideObstacle).toBe(false);
      expect(snapshot.x).toBeGreaterThan(room.minX);
      expect(snapshot.x).toBeLessThan(room.maxX);
      expect(snapshot.z).toBeGreaterThan(room.minZ);
      expect(snapshot.z).toBeLessThan(room.maxZ);
      expect(world.state.every(Number.isFinite)).toBe(true);
    }

    const kinds = world.events.map((event) => event.kind);
    expect(kinds).toEqual(['spawn', 'damage', 'feed', 'regrow']);
    // Damage hits a fully grown organism and removes a visible part of it.
    expect(grown).toBe(true);
    expect(model.nodes - fewestAliveAfterGrowth).toBeGreaterThanOrEqual(model.nodes * 0.2);

    const end = world.snapshot();
    expect(end.aliveNodes).toBe(model.nodes);
    expect(end.energy).toBeGreaterThan(0.2);
    expect(end.x).toBeGreaterThan(obstacle.maxX);
  });

  it('thickens the organism while it feeds at the doorway', () => {
    const world = new GrayboxWorld(model, SEED);
    const meanThickness = () => {
      let sum = 0;
      for (let node = 0; node < model.nodes; node += 1) sum += world.state[node * model.channels + 1]!;
      return sum / model.nodes;
    };
    world.step(120);
    const beforeFood = meanThickness();
    world.step(780);
    expect(meanThickness()).toBeGreaterThan(beforeFood + 0.05);
  });
});
