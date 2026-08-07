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
    expect(Array.from(first.restPositions).every(Number.isFinite)).toBe(true);
  });

  it('keeps every edge inside its organism and below the graph-degree contract', () => {
    const topology = createMorphologyTopology(QUALITY_TIERS.desktop, 99);
    for (let edge = 0; edge < topology.edges.length; edge += 2) {
      const start = topology.edges[edge] ?? 0;
      const end = topology.edges[edge + 1] ?? start;
      expect(topology.nodeOrganism[start]).toBe(topology.nodeOrganism[end]);
    }
    expect(maximumTopologyDegree(topology)).toBeLessThanOrEqual(8);
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
