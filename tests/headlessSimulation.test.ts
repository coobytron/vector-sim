import { describe, expect, it } from 'vitest';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';

describe('HeadlessSimulation', () => {
  it('runs without a document, canvas, or Three.js renderer', () => {
    expect(globalThis.document).toBeUndefined();
    const simulation = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 11 });
    simulation.step();
    expect(simulation.tick).toBe(1);
    expect(simulation.snapshot.positions.length).toBe(4 * 128 * 3);
  });

  it('produces deterministic state hashes for the same fixture', () => {
    const first = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 99 });
    const second = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 99 });
    for (let tick = 0; tick < 60; tick += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('changes state identity when the run seed changes', () => {
    const first = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 1 });
    const second = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 2 });
    for (let tick = 0; tick < 8; tick += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).not.toBe(second.stateHash());
  });
});

