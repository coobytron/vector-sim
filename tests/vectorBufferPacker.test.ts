import { describe, expect, it } from 'vitest';
import { VectorBufferPacker } from '../src/rendering/vectorBufferPacker';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';

describe('VectorBufferPacker', () => {
  it('packs nodes, edges, and sparse ribbons from the headless snapshot', () => {
    const simulation = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 12 });
    simulation.step();
    const packer = new VectorBufferPacker(simulation.snapshot);
    const buffers = packer.update(simulation.snapshot, 0.5);
    expect(buffers.nodePositions.length).toBe(simulation.nodeCount * 3);
    expect(buffers.nodeScales.length).toBe(simulation.nodeCount);
    expect(buffers.edgePositions.length).toBe(simulation.snapshot.edges.length * 3);
    expect(buffers.ribbonPositions.length).toBe(buffers.ribbonCount * 12);
    expect(Array.from(buffers.nodePositions).every(Number.isFinite)).toBe(true);
  });
});

