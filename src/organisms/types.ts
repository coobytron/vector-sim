import type { QualityTier } from '../simulation/types';

export type MorphologyFamily = 'branching' | 'ribbon' | 'radial';

export type MorphologyLod = 'overview' | 'mid' | 'macro';

export type OrganismVisualState =
  | 'dormant'
  | 'feeding'
  | 'starving'
  | 'damaged'
  | 'mutating'
  | 'dying'
  | 'death'
  | 'regenerating';

export const ORGANISM_STATE_CODE: Record<OrganismVisualState, number> = {
  dormant: 0,
  feeding: 1,
  starving: 2,
  damaged: 3,
  mutating: 4,
  dying: 5,
  death: 6,
  regenerating: 7,
};

export const NODE_ROLE = {
  core: 0,
  structure: 1,
  junction: 2,
  terminal: 3,
} as const;

export type NodeRole = (typeof NODE_ROLE)[keyof typeof NODE_ROLE];

export const EDGE_KIND = {
  structure: 0,
  ribbon: 1,
  contour: 2,
  branch: 3,
} as const;

export type EdgeKind = (typeof EDGE_KIND)[keyof typeof EDGE_KIND];

export interface OrganismDescriptor {
  id: string;
  seed: number;
  family: MorphologyFamily;
  start: number;
  count: number;
  center: readonly [number, number, number];
  forward: readonly [number, number, number];
}

export interface MorphologyTopology {
  tier: QualityTier;
  seed: number;
  organisms: readonly OrganismDescriptor[];
  restPositions: Float32Array;
  nodeOrganism: Uint16Array;
  nodeParent: Uint32Array;
  nodeRole: Uint8Array;
  edges: Uint32Array;
  edgeKind: Uint8Array;
  edgeImportance: Uint8Array;
}

export interface VisualDecodeInput {
  energy: number;
  health: number;
  previousHealth: number;
  activity: number;
  thicknessSignal: number;
  curvatureSignal: number;
  connectivitySignal: number;
  role: NodeRole;
  phase: number;
  stateOverride?: OrganismVisualState;
}

export interface DecodedCellVisual {
  state: OrganismVisualState;
  thickness: number;
  curvature: number;
  opacity: number;
  connectivity: number;
  ribbonWeight: number;
  baseTone: number;
  wavelengthNm: number;
  emissionStrength: number;
}
