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

interface FaceRecord {
  a: number;
  b: number;
  c: number;
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

interface LocalEdgeRecord {
  start: number;
  end: number;
  kind: EdgeKind;
  importance: number;
}

interface LocalFaceRecord {
  a: number;
  b: number;
  c: number;
  importance: number;
}

interface LocalMorphology {
  nodes: LocalNode[];
  edges: LocalEdgeRecord[];
  faces: LocalFaceRecord[];
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

function triangleWave(value: number): number {
  const wrapped = value - Math.floor(value);
  return 1 - Math.abs(wrapped * 4 - 2);
}

function addFacet(
  edges: LocalEdgeRecord[],
  faces: LocalFaceRecord[],
  a: number,
  b: number,
  c: number,
  importance: number,
): void {
  edges.push({ start: a, end: c, kind: EDGE_KIND.contour, importance });
  faces.push({ a, b, c, importance });
}

function createBranchingMorphology(slots: number): LocalMorphology {
  const nodes: LocalNode[] = [];
  const edges: LocalEdgeRecord[] = [];
  const faces: LocalFaceRecord[] = [];
  const trunkLength = Math.min(slots, Math.max(8, Math.min(18, Math.round(slots * 0.14))));

  for (let local = 0; local < trunkLength; local += 1) {
    const importance = local === 0 || local === trunkLength - 1 || local % 4 === 0 ? 2 : 1;
    nodes.push({
      x: triangleWave(local * 0.29 + 0.18) * 0.055 + Math.sin(local * 1.73) * 0.014,
      y: 0.18 + local * 0.052,
      z: triangleWave(local * 0.21 + 0.61) * 0.052 + Math.cos(local * 1.17) * 0.012,
      parent: local === 0 ? NO_PARENT : local - 1,
      role: local === 0
        ? NODE_ROLE.core
        : local === trunkLength - 1
          ? NODE_ROLE.terminal
          : local % 4 === 0
            ? NODE_ROLE.junction
            : NODE_ROLE.structure,
      edgeKind: EDGE_KIND.structure,
      importance,
    });
    if (local >= 2 && local % 3 === 2) addFacet(edges, faces, local - 2, local - 1, local, 1);
  }

  const branchRanges: Array<{ start: number; count: number; parent: number }> = [];
  const primaryBranches = Math.min(6, Math.max(3, Math.floor((slots - trunkLength) / 12)));
  let branch = 0;
  while (nodes.length < slots) {
    let parent: number;
    if (branch < primaryBranches || branchRanges.length === 0) {
      parent = Math.min(trunkLength - 1, 2 + (branch * 3) % Math.max(1, trunkLength - 3));
    } else {
      const parentRange = branchRanges[(branch - primaryBranches) % branchRanges.length];
      if (!parentRange) break;
      parent = parentRange.start + Math.min(parentRange.count - 1, 3 + (branch % 4));
    }
    const root = nodes[parent];
    if (!root) break;
    root.role = NODE_ROLE.junction;
    root.importance = 2;

    const start = nodes.length;
    const count = Math.min(8 + (branch % 4), slots - start);
    const azimuth = branch * 2.399963229728653 + (branch % 2) * 0.27;
    let x = root.x;
    let y = root.y;
    let z = root.z;
    for (let along = 0; along < count; along += 1) {
      const kink = Math.floor(along / 2) * (branch % 2 === 0 ? 0.19 : -0.23);
      const direction = azimuth + kink + triangleWave(along * 0.37 + branch * 0.13) * 0.16;
      const step = 0.052 + ((along + branch) % 3) * 0.006;
      x += Math.cos(direction) * step;
      z += Math.sin(direction) * step;
      y += 0.021 + (((along + branch) % 4) - 1.5) * 0.006;
      const local = nodes.length;
      const terminal = along === count - 1 || local === slots - 1;
      const primary = branch < primaryBranches;
      nodes.push({
        x,
        y,
        z,
        parent: along === 0 ? parent : local - 1,
        role: terminal ? NODE_ROLE.terminal : along % 4 === 0 ? NODE_ROLE.junction : NODE_ROLE.structure,
        edgeKind: EDGE_KIND.branch,
        importance: terminal || (primary && along % 2 === 0) ? 2 : 1,
      });
      if (along >= 2 && along % 3 === 2) {
        addFacet(edges, faces, local - 2, local - 1, local, primary ? 1 : 0);
      }
    }
    branchRanges.push({ start, count, parent });
    branch += 1;
  }
  const cageCenter = Math.floor(trunkLength * 0.52);
  const cageBranches = Math.min(primaryBranches, branchRanges.length);
  for (let index = 0; index < cageBranches; index += 1) {
    const current = branchRanges[index];
    const next = branchRanges[(index + 1) % cageBranches];
    if (!current || !next) continue;
    const a = current.start + Math.min(2, current.count - 1);
    const b = next.start + Math.min(2, next.count - 1);
    edges.push({ start: a, end: b, kind: EDGE_KIND.contour, importance: 1 });
    faces.push({ a: cageCenter, b: a, c: b, importance: 0 });
  }
  return { nodes, edges, faces };
}

function ribbonCenter(amount: number): readonly [number, number, number] {
  if (amount < 0.64) {
    const trail = amount / 0.64;
    return [
      -0.78 + trail * 1.03,
      0.72 + Math.sin(trail * Math.PI * 2) * 0.1 + trail * 0.06,
      -0.08 + Math.sin(trail * Math.PI) * 0.14,
    ];
  }
  const curl = (amount - 0.64) / 0.36;
  const radius = 0.105 + curl * 0.06;
  return [
    0.25 + Math.sin(curl * Math.PI * 2.4) * radius,
    0.78 + Math.sin(curl * Math.PI * 3.2) * 0.18,
    -0.08 + (1 - Math.cos(curl * Math.PI * 2.2)) * 0.12,
  ];
}

function createRibbonMorphology(slots: number): LocalMorphology {
  const nodes: LocalNode[] = [];
  const edges: LocalEdgeRecord[] = [];
  const faces: LocalFaceRecord[] = [];
  const slices = Math.ceil(slots / 2);

  for (let slice = 0; slice < slices; slice += 1) {
    const amount = slices <= 1 ? 0 : slice / (slices - 1);
    const epsilon = 1 / Math.max(4, slices - 1);
    const center = ribbonCenter(amount);
    const before = ribbonCenter(Math.max(0, amount - epsilon));
    const after = ribbonCenter(Math.min(1, amount + epsilon));
    const tangentX = after[0] - before[0];
    const tangentY = after[1] - before[1];
    const tangentZ = after[2] - before[2];
    let normalX = -tangentZ;
    let normalY = tangentX * 0.24 + Math.sin(amount * Math.PI * 5) * 0.16;
    let normalZ = tangentX - tangentY * 0.16;
    const normalLength = Math.max(0.0001, Math.hypot(normalX, normalY, normalZ));
    normalX /= normalLength;
    normalY /= normalLength;
    normalZ /= normalLength;
    const trailEnvelope = Math.pow(Math.max(0, Math.sin(Math.min(1, amount / 0.72) * Math.PI)), 0.8);
    const cage = Math.max(0, Math.min(1, (amount - 0.52) / 0.22));
    const halfWidth = 0.016 + trailEnvelope * 0.018 + cage * (0.075 + Math.sin(amount * Math.PI * 5) * 0.012);

    for (let side = 0; side < 2 && nodes.length < slots; side += 1) {
      const sign = side === 0 ? -1 : 1;
      const local = nodes.length;
      const first = slice === 0;
      const last = slice === slices - 1 || local >= slots - 2;
      const keySlice = slice % 8 === 0;
      nodes.push({
        x: center[0] + normalX * halfWidth * sign,
        y: center[1] + normalY * halfWidth * sign,
        z: center[2] + normalZ * halfWidth * sign,
        parent: first ? (side === 0 ? NO_PARENT : 0) : local - 2,
        role: first && side === 0
          ? NODE_ROLE.core
          : last
            ? NODE_ROLE.terminal
            : keySlice
              ? NODE_ROLE.junction
              : NODE_ROLE.structure,
        edgeKind: side === 0 ? EDGE_KIND.structure : EDGE_KIND.ribbon,
        importance: first || last || side === 0 || keySlice ? 2 : 1,
      });
    }

    const left = slice * 2;
    const right = left + 1;
    if (slice > 0 && right < nodes.length) {
      const previousLeft = left - 2;
      const previousRight = right - 2;
      const keySlice = slice % 8 === 0 || slice === slices - 1;
      const cage = amount >= 0.54;
      if (!cage && slice % 6 !== 0) continue;
      edges.push({
        start: left,
        end: right,
        kind: EDGE_KIND.contour,
        importance: keySlice ? 2 : cage && slice % 2 === 0 ? 1 : 0,
      });
      if (!cage) continue;
      edges.push({
        start: previousLeft,
        end: right,
        kind: EDGE_KIND.contour,
        importance: keySlice ? 1 : 0,
      });
      faces.push(
        { a: previousLeft, b: left, c: right, importance: keySlice ? 1 : 0 },
        { a: previousLeft, b: right, c: previousRight, importance: keySlice ? 1 : 0 },
      );
    }
  }
  return { nodes, edges, faces };
}

function createRadialMorphology(slots: number): LocalMorphology {
  const nodes: LocalNode[] = [{
    x: 0,
    y: 0.76,
    z: 0,
    parent: NO_PARENT,
    role: NODE_ROLE.core,
    edgeKind: EDGE_KIND.structure,
    importance: 2,
  }];
  const edges: LocalEdgeRecord[] = [];
  const faces: LocalFaceRecord[] = [];
  if (slots <= 1) return { nodes: nodes.slice(0, slots), edges, faces };
  const spokes = Math.min(8, Math.max(3, slots - 1));
  const rings = Math.ceil((slots - 1) / spokes);

  for (let ring = 1; ring <= rings && nodes.length < slots; ring += 1) {
    const ringStart = nodes.length;
    const count = Math.min(spokes, slots - ringStart);
    for (let spoke = 0; spoke < count; spoke += 1) {
      const angle = (spoke / spokes) * Math.PI * 2 + ring * 0.19 + (spoke % 2) * 0.055;
      const polar = (ring / (rings + 1)) * Math.PI;
      const shell = 0.36 * (1 + Math.sin(spoke * 2.1 + ring * 0.7) * 0.055);
      const radius = Math.sin(polar) * shell;
      const local = nodes.length;
      const terminal = ring === rings || local + spokes >= slots;
      const keySpoke = spoke % 2 === 0;
      nodes.push({
        x: Math.cos(angle) * radius * (1 + Math.sin(ring * 0.61) * 0.08),
        y: 0.76 + Math.cos(polar) * 0.34 + Math.sin(angle * 1.45 + ring * 0.31) * 0.035,
        z: Math.sin(angle) * radius * 0.9,
        parent: ring === 1 ? 0 : local - spokes,
        role: terminal
          ? NODE_ROLE.terminal
          : ring % 4 === 0 || keySpoke && ring % 3 === 0
            ? NODE_ROLE.junction
            : NODE_ROLE.structure,
        edgeKind: EDGE_KIND.branch,
        importance: terminal || keySpoke ? 2 : 1,
      });
    }

    for (let spoke = 0; spoke < count; spoke += 1) {
      const current = ringStart + spoke;
      const next = ringStart + ((spoke + 1) % count);
      const outer = ring === rings;
      edges.push({
        start: current,
        end: next,
        kind: ring % 3 === 0 ? EDGE_KIND.contour : EDGE_KIND.structure,
        importance: outer ? 2 : ring % 4 === 0 ? 1 : 0,
      });
      if (ring === 1) {
        faces.push({ a: 0, b: current, c: next, importance: 1 });
        continue;
      }
      const previous = current - spokes;
      const previousNext = next - spokes;
      if (previous <= 0 || previousNext <= 0) continue;
      edges.push({
        start: current,
        end: previousNext,
        kind: EDGE_KIND.structure,
        importance: outer && spoke % 2 === 0 ? 1 : 0,
      });
      faces.push(
        { a: previous, b: current, c: next, importance: outer ? 1 : 0 },
        { a: previous, b: next, c: previousNext, importance: outer ? 1 : 0 },
      );
    }
  }
  return { nodes, edges, faces };
}

function createLocalMorphology(family: MorphologyFamily, slots: number): LocalMorphology {
  switch (family) {
    case 'branching':
      return createBranchingMorphology(slots);
    case 'ribbon':
      return createRibbonMorphology(slots);
    case 'radial':
      return createRadialMorphology(slots);
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

export function createMorphologyTopology(tier: QualityTier, seed: number): MorphologyTopology {
  const nodeCount = tier.organisms * tier.slotsPerOrganism;
  const restPositions = new Float32Array(nodeCount * 3);
  const nodeOrganism = new Uint16Array(nodeCount);
  const nodeParent = new Uint32Array(nodeCount);
  const nodeRole = new Uint8Array(nodeCount);
  const nodeImportance = new Uint8Array(nodeCount);
  nodeParent.fill(NO_PARENT);
  const organisms: OrganismDescriptor[] = [];
  const edges: EdgeRecord[] = [];
  const faces: FaceRecord[] = [];

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

    const morphology = createLocalMorphology(family, tier.slotsPerOrganism);

    for (let local = 0; local < tier.slotsPerOrganism; local += 1) {
      const node = start + local;
      const shape = morphology.nodes[local];
      if (!shape) throw new RangeError(`${family} morphology produced ${morphology.nodes.length} of ${tier.slotsPerOrganism} nodes.`);
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
      nodeImportance[node] = shape.importance;
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
    for (const edge of morphology.edges) {
      edges.push({
        start: start + edge.start,
        end: start + edge.end,
        kind: edge.kind,
        importance: edge.importance,
      });
    }
    for (const face of morphology.faces) {
      faces.push({
        a: start + face.a,
        b: start + face.b,
        c: start + face.c,
        importance: face.importance,
      });
    }
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

  const faceIndices = new Uint32Array(faces.length * 3);
  const faceImportance = new Uint8Array(faces.length);
  for (let face = 0; face < faces.length; face += 1) {
    const record = faces[face];
    if (!record) continue;
    faceIndices[face * 3] = record.a;
    faceIndices[face * 3 + 1] = record.b;
    faceIndices[face * 3 + 2] = record.c;
    faceImportance[face] = record.importance;
  }

  return {
    tier,
    seed: seed >>> 0,
    organisms,
    restPositions,
    nodeOrganism,
    nodeParent,
    nodeRole,
    nodeImportance,
    edges: edgePairs,
    edgeKind,
    edgeImportance,
    faces: faceIndices,
    faceImportance,
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
