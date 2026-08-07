import { describe, expect, it } from 'vitest';
import {
  countVisibleEdges,
  createMorphologyTopology,
  maximumTopologyDegree,
  selectMorphologyLod,
} from '../src/organisms/morphology';
import { QUALITY_TIERS } from '../src/simulation/types';

describe('morphology topology', () => {
  it('builds related Branching, Ribbon, and Radial families with stable identities', () => {
    const first = createMorphologyTopology(QUALITY_TIERS.mobile, 0x1234);
    const second = createMorphologyTopology(QUALITY_TIERS.mobile, 0x1234);
    const changed = createMorphologyTopology(QUALITY_TIERS.mobile, 0x1235);
    expect(first.organisms.slice(0, 3).map((organism) => organism.family)).toEqual([
      'branching',
      'ribbon',
      'radial',
    ]);
    expect(first.organisms.map((organism) => organism.id)).toEqual(
      second.organisms.map((organism) => organism.id),
    );
    expect(first.organisms[0]?.id).not.toBe(changed.organisms[0]?.id);
    expect(first.restPositions).toEqual(second.restPositions);
    expect(first.nodeImportance).toEqual(second.nodeImportance);
    expect(first.faces).toEqual(second.faces);
    expect(Array.from(first.restPositions).every(Number.isFinite)).toBe(true);
  });

  it('keeps every edge and face inside its organism and below the graph-degree contract', () => {
    const topology = createMorphologyTopology(QUALITY_TIERS.desktop, 99);
    for (let edge = 0; edge < topology.edges.length; edge += 2) {
      const start = topology.edges[edge] ?? 0;
      const end = topology.edges[edge + 1] ?? start;
      expect(topology.nodeOrganism[start]).toBe(topology.nodeOrganism[end]);
    }
    for (let face = 0; face < topology.faces.length; face += 3) {
      const a = topology.faces[face] ?? 0;
      const b = topology.faces[face + 1] ?? a;
      const c = topology.faces[face + 2] ?? a;
      expect(topology.nodeOrganism[a]).toBe(topology.nodeOrganism[b]);
      expect(topology.nodeOrganism[a]).toBe(topology.nodeOrganism[c]);
    }
    expect(maximumTopologyDegree(topology)).toBeLessThanOrEqual(8);
  });

  it('uses volumetric constellation forms instead of one-dimensional diagram paths', () => {
    const topology = createMorphologyTopology(QUALITY_TIERS.mobile, 0x5350_4543);
    for (const descriptor of topology.organisms.slice(0, 3)) {
      const minimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      const maximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
      for (let local = 0; local < descriptor.count; local += 1) {
        const offset = (descriptor.start + local) * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          minimum[axis] = Math.min(minimum[axis] ?? 0, topology.restPositions[offset + axis] ?? 0);
          maximum[axis] = Math.max(maximum[axis] ?? 0, topology.restPositions[offset + axis] ?? 0);
        }
      }
      const extents = minimum.map((value, axis) => (maximum[axis] ?? value) - value);
      expect(Math.min(...extents)).toBeGreaterThan(0.16);
    }
    const ribbon = topology.organisms[1];
    expect(ribbon).toBeDefined();
    const ribbonFaces = Array.from(topology.faces).filter(
      (node, index) => index % 3 === 0 && topology.nodeOrganism[node] === 1,
    ).length;
    expect(ribbonFaces).toBeGreaterThan(48);
  });

  it('removes only lower-importance detail as distance increases', () => {
    const topology = createMorphologyTopology(QUALITY_TIERS.mobile, 44);
    const macro = countVisibleEdges(topology, 'macro');
    const mid = countVisibleEdges(topology, 'mid');
    const overview = countVisibleEdges(topology, 'overview');
    expect(macro).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(overview);
    expect(overview).toBeGreaterThan(0);
    expect(selectMorphologyLod(3, QUALITY_TIERS.desktop)).toBe('macro');
    expect(selectMorphologyLod(5.5, QUALITY_TIERS.desktop)).toBe('mid');
    expect(selectMorphologyLod(8.5, QUALITY_TIERS.desktop)).toBe('overview');
  });
});
