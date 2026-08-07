import { describe, expect, it } from 'vitest';
import { VectorBufferPacker } from '../src/rendering/vectorBufferPacker';
import { ORGANISM_STATE_CODE } from '../src/organisms/types';
import { HeadlessSimulation } from '../src/simulation/headlessSimulation';
import { QUALITY_TIERS } from '../src/simulation/types';

describe('VectorBufferPacker', () => {
  it('packs nodes, edges, sparse ribbons, and polyhedral faces from the headless snapshot', () => {
    const simulation = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 12 });
    simulation.step();
    const packer = new VectorBufferPacker(simulation.snapshot);
    const buffers = packer.update(simulation.snapshot, 0.5);
    expect(buffers.nodePositions.length).toBe(simulation.nodeCount * 3);
    expect(buffers.nodeScales.length).toBe(simulation.nodeCount);
    expect(buffers.edgePositions.length).toBe(simulation.snapshot.edges.length * 3);
    expect(buffers.ribbonPositions.length).toBe(buffers.ribbonCount * 12);
    expect(buffers.facePositions.length).toBe(buffers.faceCount * 9);
    expect(buffers.faceCount).toBeGreaterThan(0);
    expect(Array.from(buffers.nodePositions).every(Number.isFinite)).toBe(true);
    expect(Array.from(buffers.facePositions).every(Number.isFinite)).toBe(true);
  });

  it('reuses pooled arrays while reconnecting and changing lifecycle presentation', () => {
    const simulation = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 22 });
    const packer = new VectorBufferPacker(simulation.snapshot);
    const positions = packer.buffers.nodePositions;
    const ribbons = packer.buffers.ribbonPositions;
    const faces = packer.buffers.facePositions;
    const feeding = packer.update(simulation.snapshot, 1, {
      lod: 'macro',
      stateOverride: 'feeding',
    });
    expect(feeding.nodeStates.every((state) => state === ORGANISM_STATE_CODE.feeding)).toBe(true);
    expect(feeding.nodeEmissionStrengths.some((strength) => strength > 0)).toBe(true);
    const feedingConnectivity = feeding.edgeActivity[0] ?? 0;
    const death = packer.update(simulation.snapshot, 1, {
      lod: 'macro',
      stateOverride: 'death',
    });
    expect(death.nodePositions).toBe(positions);
    expect(death.ribbonPositions).toBe(ribbons);
    expect(death.facePositions).toBe(faces);
    expect(death.nodeStates.every((state) => state === ORGANISM_STATE_CODE.death)).toBe(true);
    expect(death.edgeActivity[0] ?? 1).toBeLessThan(feedingConnectivity);
  });

  it('collapses detail for overview LOD without reallocating geometry', () => {
    const simulation = new HeadlessSimulation({ tier: QUALITY_TIERS.mobile, seed: 23 });
    const packer = new VectorBufferPacker(simulation.snapshot);
    const macro = packer.update(simulation.snapshot, 1, { lod: 'macro' });
    const macroVisible = Array.from(macro.edgeActivity).filter((value) => value > 0).length;
    const macroFaces = Array.from(macro.faceActivity).filter((value) => value > 0).length;
    const overview = packer.update(simulation.snapshot, 1, { lod: 'overview' });
    const overviewVisible = Array.from(overview.edgeActivity).filter((value) => value > 0).length;
    const overviewFaces = Array.from(overview.faceActivity).filter((value) => value > 0).length;
    expect(overviewVisible).toBeLessThan(macroVisible);
    expect(overviewFaces).toBeLessThan(macroFaces);
    expect(overview.edgePositions).toBe(macro.edgePositions);
    expect(overview.facePositions).toBe(macro.facePositions);
  });
});
