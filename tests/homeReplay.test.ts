import { describe, expect, it } from 'vitest';
import weights from '../src/nca/models/branching-m1.weights.json';
import { loadGraphNcaModel } from '../src/nca/graph/graphNcaRuntime';
import type { GraphNcaWeightsJson } from '../src/nca/graph/graphNcaRuntime';
import { HOME_PRESETS } from '../src/environments/homePresets';
import {
  HOME_STATE_SCHEMA,
  HomeStateError,
  exportHomeState,
  replayHomeWorld,
  restoreHomeState,
} from '../src/homeSim/homeReplay';
import { HomeWorld } from '../src/homeSim/homeWorld';

const model = loadGraphNcaModel(weights as GraphNcaWeightsJson);
const COURTYARD = HOME_PRESETS['courtyard-house'];
const CAMERA = { position: [1, 2, 3], target: [0, 0.2, 0], fovDegrees: 42 } as const;

/** A live session: food, then the fault, then shelter, with goal changes mid-run. */
function liveSession(): { world: HomeWorld; hashes: Record<number, string> } {
  const world = new HomeWorld(model, COURTYARD, 7, { goal: 'food' });
  const hashes: Record<number, string> = { 0: world.signature() };
  world.step(120);
  world.setGoal('fault');
  world.step(180);
  hashes[300] = world.signature();
  world.setGoal('stay');
  world.step(50);
  world.setGoal('shelter');
  world.step(550);
  hashes[900] = world.signature();
  return { world, hashes };
}

describe('M4 replay and state export', { timeout: 60_000 }, () => {
  it('replays a seed and input timeline to identical hashes at ticks 0, 300 and 900', () => {
    const { world, hashes } = liveSession();
    expect(world.inputs).toEqual([
      { tick: 0, goal: 'food' },
      { tick: 120, goal: 'fault' },
      { tick: 300, goal: 'stay' },
      { tick: 350, goal: 'shelter' },
    ]);
    for (const tick of [0, 300, 900] as const) {
      expect(replayHomeWorld(model, COURTYARD, 7, world.inputs, tick).signature()).toBe(hashes[tick]);
    }
  });

  it('exports a versioned state that restores the same world, look and camera', () => {
    const { world } = liveSession();
    const saved = JSON.parse(JSON.stringify(exportHomeState(world, 'porcelain', CAMERA)));
    expect(saved.schema).toBe(HOME_STATE_SCHEMA);
    const { world: restored, state } = restoreHomeState(model, saved);
    expect(restored.tick).toBe(900);
    expect(restored.signature()).toBe(world.signature());
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(restored.inputs).toEqual(world.inputs);
    expect(state.look).toBe('porcelain');
    expect(state.camera).toEqual(CAMERA);
    // The restored world keeps running in lockstep with the original.
    world.step(60);
    restored.step(60);
    expect(restored.signature()).toBe(world.signature());
  });

  it('rejects tampered, unknown or out-of-order states', () => {
    const { world } = liveSession();
    const saved = exportHomeState(world, 'porcelain', CAMERA);
    expect(() => restoreHomeState(model, { ...saved, hash: '00000000' })).toThrow(/does not match/);
    expect(() => restoreHomeState(model, { ...saved, schema: 'vector-sim.home-state.v0' })).toThrow(HomeStateError);
    expect(() => restoreHomeState(model, { ...saved, presetId: 'nowhere' })).toThrow(/unknown preset/);
    expect(() => restoreHomeState(model, { ...saved, inputs: [{ tick: 5, goal: 'food' }] })).toThrow(/out of order/);
    expect(() => restoreHomeState(model, { ...saved, model: 'branching:00000000' })).toThrow(/saved with model/);
  });
});
