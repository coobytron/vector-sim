import { counterRandom, mix32 } from '../simulation/prng';
import type { QualityTier } from '../simulation/types';
import {
  EDGE_KIND,
  NODE_ROLE,
  type EdgeKind,
  type MorphologyFamily,
  type MorphologyLod,
  type MorphologyTopology,
  type NodeRole,
  type OrganismDescriptor,
} from './types';

const NO_PARENT = 0xffff_ffff;
const FAMILY_ORDER: readonly MorphologyFamily[] = ['branching', 'ribbon', 'radial'];

interface EdgeRecord {
  start: number;
  end: number;
  kind: EdgeKind;
  importance: number;
}

interface LocalNode {
  x: number;
  y: number;
  z: number;
  parent: number;
  role: NodeRole;
  edgeKind: EdgeKind;
  importance: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function familyFor(organism: number): MorphologyFamily {
  return FAMILY_ORDER[organism % FAMILY_ORDER.length] ?? 'branching';
}

function stableOrganismId(seed: number, organism: number): string {
  const high = BigInt(seed >>> 0) << 32n;
  const low = BigInt(mix32(seed ^ Math.imul(organism + 1, 0x9e37_79b1)));
  return (high | low).toString();
}

function branchingNode(local: number, slots: number): LocalNode {
  const trunkLength = Math.min(16, slots);
  if (local < trunkLength) {
    const phase = local * 0.58;
    return {
      x: Math.sin(phase) * 0.035,
      y: 0.24 + local * 0.055,
      z: Math.cos(phase) * 0.035,
      parent: local === 0 ? NO_PARENT : local - 1,
      role: local === 0
        ? NODE_ROLE.core
        : local === trunkLength - 1
          ? NODE_ROLE.terminal
          : local % 3 === 0
            ? NODE_ROLE.junction
            : NODE_ROLE.structure,
      edgeKind: EDGE_KIND.structure,
      importance: local === 0 || local === trunkLength - 1 ? 2 : 1,
    };
  }

  const branchLength = 16;
  const branch = Math.floor((local - trunkLength) / branchLength);
  const along = (local - trunkLength) % branchLength;
  const branchCount = Math.max(1, Math.ceil((slots - trunkLength) / branchLength));
  const angle = (branch / branchCount) * Math.PI * 2 + (branch % 2) * 0.22;
  const attachment = 2 + (branch * 3) % Math.max(1, trunkLength - 3);
  const distance = (along + 1) * 0.055;
  const fork = 1 + 0.15 * Math.sin(along * 0.8 + branch);
  return {
    x: Math.cos(angle) * distance * fork,
    y: 0.24 + attachment * 0.055 + along * 0.032,
    z: Math.sin(angle) * distance * fork,
    parent: along === 0 ? attachment : local - 1,
    role: along === 0
      ? NODE_ROLE.junction
      : along === branchLength - 1 || local === slots - 1
        ? NODE_ROLE.terminal
        : NODE_ROLE.structure,
    edgeKind: EDGE_KIND.branch,
    importance: along === 0 || along === branchLength - 1 || local === slots - 1 ? 2 : 1,
  };
}

function ribbonNode(local: number, slots: number): LocalNode {
  const amount = slots <= 1 ? 0 : local / (slots - 1);
  const sweep = (amount - 0.5) * 1.55;
  const fold = amount * Math.PI * 5;
  const curl = amount * Math.PI * 2;
  return {
    x: sweep,
    y: 0.73 + Math.sin(fold) * 0.2 + Math.sin(curl) * 0.06,
    z: Math.cos(fold * 0.72) * 0.24 + Math.sin(curl * 1.5) * 0.08,
    parent: local === 0 ? NO_PARENT : local - 1,
    role: local === 0
      ? NODE_ROLE.core
      : local === slots - 1
        ? NODE_ROLE.terminal
        : local % 16 === 0
          ? NODE_ROLE.junction
          : NODE_ROLE.structure,
    edgeKind: EDGE_KIND.ribbon,
    importance: local === 0 || local === slots - 1 || local % 16 === 0 ? 2 : 1,
  };
}

function radialNode(local: number, slots: number): LocalNode {
  if (local === 0) {
    return {
      x: 0,
      y: 0.78,
      z: 0,
      parent: NO_PARENT,
      role: NODE_ROLE.core,
      edgeKind: EDGE_KIND.structure,
      importance: 2,
    };
  }
  const spokes = Math.min(8, Math.max(3, slots - 1));
  const ring = Math.floor((local - 1) / spokes) + 1;
  const spoke = (local - 1) % spokes;
  const angle = (spoke / spokes) * Math.PI * 2 + ring * 0.08;
  const radius = 0.055 + ring * 0.045;
  const previousRing = local - spokes;
  const finalRing = Math.ceil((slots - 1) / spokes);
  return {
    x: Math.cos(angle) * radius,
    y: 0.78 + Math.sin(angle) * radius,
    z: Math.cos(ring * 0.43) * 0.09 + Math.sin(angle * 2) * radius * 0.08,
    parent: ring === 1 ? 0 : previousRing,
    role: ring === finalRing || local + spokes >= slots
      ? NODE_ROLE.terminal
      : ring % 3 === 0
        ? NODE_ROLE.junction
        : NODE_ROLE.structure,
    edgeKind: EDGE_KIND.branch,
    importance: ring === 1 || ring === finalRing || local + spokes >= slots ? 2 : 1,
  };
}

function localNode(family: MorphologyFamily, local: number, slots: number): LocalNode {
  switch (family) {
    case 'branching':
      return branchingNode(local, slots);
    case 'ribbon':
      return ribbonNode(local, slots);
    case 'radial':
      return radialNode(local, slots);
  }
}

function rotateAndPlace(
  x: number,
  y: number,
  z: number,
  angle: number,
  centerX: number,
  centerZ: number,
): readonly [number, number, number] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    centerX + x * cosine - z * sine,
    y,
    centerZ + x * sine + z * cosine,
  ];
}

function addSupplementalEdges(
  family: MorphologyFamily,
  start: number,
  slots: number,
  edges: EdgeRecord[],
): void {
  if (family === 'ribbon') {
    for (let local = 15; local < slots; local += 16) {
      edges.push({
        start: start + local - 15,
        end: start + local,
        kind: EDGE_KIND.contour,
        importance: 0,
      });
    }
    return;
  }
  if (family !== 'radial') return;
  const spokes = Math.min(8, Math.max(3, slots - 1));
  const rings = Math.ceil((slots - 1) / spokes);
  for (let ring = 3; ring <= rings; ring += 3) {
    const ringStart = 1 + (ring - 1) * spokes;
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const current = ringStart + spoke;
      const next = ringStart + ((spoke + 1) % spokes);
      if (current < slots && next < slots) {
        edges.push({
          start: start + current,
          end: start + next,
          kind: EDGE_KIND.contour,
          importance: ring === rings ? 2 : 0,
        });
      }
    }
  }
}

export function createMorphologyTopology(tier: QualityTier, seed: number): MorphologyTopology {
  const nodeCount = tier.organisms * tier.slotsPerOrganism;
  const restPositions = new Float32Array(nodeCount * 3);
  const nodeOrganism = new Uint16Array(nodeCount);
  const nodeParent = new Uint32Array(nodeCount);
  const nodeRole = new Uint8Array(nodeCount);
  nodeParent.fill(NO_PARENT);
  const organisms: OrganismDescriptor[] = [];
  const edges: EdgeRecord[] = [];

  for (let organism = 0; organism < tier.organisms; organism += 1) {
    const family = familyFor(organism);
    const angle = (organism / Math.max(1, tier.organisms)) * Math.PI * 2;
    const centerRadius = tier.organisms <= 3 ? 0.85 : 1.12;
    const centerX = Math.cos(angle) * centerRadius;
    const centerZ = Math.sin(angle) * centerRadius * 0.66;
    const start = organism * tier.slotsPerOrganism;
    const organismSeed = mix32(seed ^ Math.imul(organism + 1, 0x85eb_ca77));
    const localForward: readonly [number, number, number] = family === 'branching'
      ? [0, 1, 0]
      : family === 'ribbon'
        ? [1, 0, 0]
        : [0, 0, 1];
    const forward = rotateAndPlace(
      localForward[0],
      localForward[1],
      localForward[2],
      angle + Math.PI,
      0,
      0,
    );
    organisms.push({
      id: stableOrganismId(seed, organism),
      seed: organismSeed,
      family,
      start,
      count: tier.slotsPerOrganism,
      center: [centerX, 0.72, centerZ],
      forward,
    });

    for (let local = 0; local < tier.slotsPerOrganism; local += 1) {
      const node = start + local;
      const shape = localNode(family, local, tier.slotsPerOrganism);
      const jitter = (counterRandom(seed, organism, local, 0, 4) - 0.5) * 0.016;
      const position = rotateAndPlace(
        shape.x + jitter,
        shape.y + jitter * 0.3,
        shape.z - jitter,
        angle + Math.PI,
        centerX,
        centerZ,
      );
      const offset = node * 3;
      restPositions[offset] = position[0];
      restPositions[offset + 1] = position[1];
      restPositions[offset + 2] = position[2];
      nodeOrganism[node] = organism;
      nodeRole[node] = shape.role;
      if (shape.parent !== NO_PARENT) {
        const parent = start + clamp(shape.parent, 0, tier.slotsPerOrganism - 1);
        nodeParent[node] = parent;
        edges.push({
          start: parent,
          end: node,
          kind: shape.edgeKind,
          importance: shape.importance,
        });
      }
    }
    addSupplementalEdges(family, start, tier.slotsPerOrganism, edges);
  }

  const edgePairs = new Uint32Array(edges.length * 2);
  const edgeKind = new Uint8Array(edges.length);
  const edgeImportance = new Uint8Array(edges.length);
  for (let edge = 0; edge < edges.length; edge += 1) {
    const record = edges[edge];
    if (!record) continue;
    edgePairs[edge * 2] = record.start;
    edgePairs[edge * 2 + 1] = record.end;
    edgeKind[edge] = record.kind;
    edgeImportance[edge] = record.importance;
  }

  return {
    tier,
    seed: seed >>> 0,
    organisms,
    restPositions,
    nodeOrganism,
    nodeParent,
    nodeRole,
    edges: edgePairs,
    edgeKind,
    edgeImportance,
  };
}

export function lodImportanceThreshold(lod: MorphologyLod): number {
  switch (lod) {
    case 'overview':
      return 2;
    case 'mid':
      return 1;
    case 'macro':
      return 0;
  }
}

export function selectMorphologyLod(distance: number, tier: QualityTier): MorphologyLod {
  const tierBias = tier.name === 'mobile' ? -0.45 : 0;
  if (distance + tierBias >= 7.4) return 'overview';
  if (distance + tierBias >= 4.8) return 'mid';
  return 'macro';
}

export function countVisibleEdges(topology: MorphologyTopology, lod: MorphologyLod): number {
  const threshold = lodImportanceThreshold(lod);
  let visible = 0;
  for (const importance of topology.edgeImportance) {
    if (importance >= threshold) visible += 1;
  }
  return visible;
}

export function maximumTopologyDegree(topology: MorphologyTopology): number {
  const degrees = new Uint8Array(topology.restPositions.length / 3);
  let maximum = 0;
  for (let index = 0; index < topology.edges.length; index += 2) {
    const start = topology.edges[index] ?? 0;
    const end = topology.edges[index + 1] ?? start;
    degrees[start] = (degrees[start] ?? 0) + 1;
    degrees[end] = (degrees[end] ?? 0) + 1;
    maximum = Math.max(maximum, degrees[start] ?? 0, degrees[end] ?? 0);
  }
  return maximum;
}

export { NO_PARENT };
