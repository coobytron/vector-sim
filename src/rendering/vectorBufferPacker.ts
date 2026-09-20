import { lodImportanceThreshold } from '../organisms/morphology';
import {
  EDGE_KIND,
  NODE_ROLE,
  ORGANISM_STATE_CODE,
  type MorphologyLod,
  type NodeRole,
  type OrganismVisualState,
  type VisualDecodeInput,
} from '../organisms/types';
import {
  applyPresentationToDecodeInput,
  type OrganismPresentationState,
} from '../organisms/presentation';
import { createDecodedCellVisual, decodeCellVisual } from '../organisms/visualState';
import type { SimulationSnapshot } from '../simulation/types';

export interface VectorPackOptions {
  lod?: MorphologyLod;
  stateOverride?: OrganismVisualState;
  /**
   * Lifecycle-derived presentation, keyed by organism index (P08b). When an
   * organism has an entry, its lifecycle state drives the decode instead of the
   * raw per-node health/energy heuristic. An explicit `stateOverride` — the
   * deterministic capture route — still wins, so captures stay pinned.
   */
  presentations?: ReadonlyMap<number, OrganismPresentationState>;
}

export interface VectorBuffers {
  nodePositions: Float32Array;
  nodeScales: Float32Array;
  nodeBaseTones: Float32Array;
  nodeWavelengths: Float32Array;
  nodeEmissionStrengths: Float32Array;
  nodeStates: Uint8Array;
  edgePositions: Float32Array;
  edgeActivity: Float32Array;
  ribbonPositions: Float32Array;
  ribbonCount: number;
  facePositions: Float32Array;
  faceActivity: Float32Array;
  faceCount: number;
  lod: MorphologyLod;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function latentChannel(snapshot: SimulationSnapshot, node: number, channel: number): number {
  return snapshot.latent[node * snapshot.channels + channel] ?? 0;
}

export class VectorBufferPacker {
  readonly buffers: VectorBuffers;
  private readonly interpolation: Float32Array;
  private readonly nodeConnectivity: Float32Array;
  private readonly nodeRibbonWeights: Float32Array;
  private readonly decodeInput: VisualDecodeInput = {
    energy: 0,
    health: 1,
    previousHealth: 1,
    activity: 0,
    thicknessSignal: 0,
    curvatureSignal: 0,
    connectivitySignal: 0,
    role: NODE_ROLE.structure,
    phase: 0,
  };
  private readonly decoded = createDecodedCellVisual();

  constructor(snapshot: SimulationSnapshot) {
    const edgeCount = snapshot.edges.length / 2;
    const faceCount = snapshot.topology.faces.length / 3;
    this.interpolation = new Float32Array(snapshot.positions.length);
    this.nodeConnectivity = new Float32Array(snapshot.active.length);
    this.nodeRibbonWeights = new Float32Array(snapshot.active.length);
    this.buffers = {
      nodePositions: new Float32Array(snapshot.positions.length),
      nodeScales: new Float32Array(snapshot.active.length),
      nodeBaseTones: new Float32Array(snapshot.active.length),
      nodeWavelengths: new Float32Array(snapshot.active.length),
      nodeEmissionStrengths: new Float32Array(snapshot.active.length),
      nodeStates: new Uint8Array(snapshot.active.length),
      edgePositions: new Float32Array(snapshot.edges.length * 3),
      edgeActivity: new Float32Array(edgeCount),
      ribbonPositions: new Float32Array(edgeCount * 4 * 3),
      ribbonCount: edgeCount,
      facePositions: new Float32Array(faceCount * 3 * 3),
      faceActivity: new Float32Array(faceCount),
      faceCount,
      lod: 'macro',
    };
  }

  update(
    snapshot: SimulationSnapshot,
    alpha: number,
    options: VectorPackOptions = {},
  ): VectorBuffers {
    const amount = clamp(alpha, 0, 1);
    const lod = options.lod ?? 'macro';
    const threshold = lodImportanceThreshold(lod);
    this.buffers.lod = lod;
    for (let index = 0; index < this.interpolation.length; index += 1) {
      const previous = snapshot.previousPositions[index] ?? 0;
      this.interpolation[index] = previous + ((snapshot.positions[index] ?? 0) - previous) * amount;
    }

    for (let node = 0; node < snapshot.active.length; node += 1) {
      const offset = node * 3;
      const role = (snapshot.topology.nodeRole[node] ?? NODE_ROLE.structure) as NodeRole;
      const organismIndex = snapshot.topology.nodeOrganism[node] ?? 0;
      const descriptor = snapshot.topology.organisms[organismIndex];
      const activity = clamp(
        (Math.abs(latentChannel(snapshot, node, 0)) +
          Math.abs(latentChannel(snapshot, node, 1)) +
          Math.abs(latentChannel(snapshot, node, 2))) * 1.8,
        0,
        1,
      );
      this.decodeInput.energy = snapshot.energy[node] ?? 0;
      this.decodeInput.health = snapshot.health[node] ?? 0;
      this.decodeInput.previousHealth = snapshot.previousHealth[node] ?? this.decodeInput.health;
      this.decodeInput.activity = activity;
      this.decodeInput.thicknessSignal = latentChannel(snapshot, node, 3);
      this.decodeInput.curvatureSignal = latentChannel(snapshot, node, 4);
      this.decodeInput.connectivitySignal = latentChannel(snapshot, node, 5);
      this.decodeInput.role = role;
      this.decodeInput.phase = snapshot.tick / 90 - node / Math.max(1, snapshot.active.length);
      this.decodeInput.stateOverride = options.stateOverride;
      this.decodeInput.emissionCeiling = undefined;
      const presentation = options.presentations?.get(organismIndex);
      if (presentation !== undefined && options.stateOverride === undefined) {
        applyPresentationToDecodeInput(presentation, this.decodeInput);
      }
      decodeCellVisual(this.decodeInput, this.decoded);

      const centerX = descriptor?.center[0] ?? 0;
      const centerZ = descriptor?.center[2] ?? 0;
      const px = this.interpolation[offset] ?? 0;
      const py = this.interpolation[offset + 1] ?? 0;
      const pz = this.interpolation[offset + 2] ?? 0;
      const radialX = px - centerX;
      const radialZ = pz - centerZ;
      const radialLength = Math.max(0.001, Math.hypot(radialX, radialZ));
      const curveX = (-radialZ / radialLength) * this.decoded.curvature;
      const curveZ = (radialX / radialLength) * this.decoded.curvature;
      this.buffers.nodePositions[offset] = px + curveX + latentChannel(snapshot, node, 0) * 0.012;
      this.buffers.nodePositions[offset + 1] =
        py + Math.sin(node * 0.47) * this.decoded.curvature * 0.28 + latentChannel(snapshot, node, 1) * 0.012;
      this.buffers.nodePositions[offset + 2] = pz + curveZ + latentChannel(snapshot, node, 2) * 0.012;
      const importance = snapshot.topology.nodeImportance[node] ?? (role === NODE_ROLE.structure ? 1 : 2);
      const visible = importance >= threshold && snapshot.active[node] === 1;
      this.buffers.nodeScales[node] = visible ? this.decoded.thickness : 0;
      this.buffers.nodeBaseTones[node] = this.decoded.baseTone;
      this.buffers.nodeWavelengths[node] = this.decoded.wavelengthNm;
      this.buffers.nodeEmissionStrengths[node] = visible ? this.decoded.emissionStrength : 0;
      this.buffers.nodeStates[node] = ORGANISM_STATE_CODE[this.decoded.state];
      this.nodeConnectivity[node] = visible ? this.decoded.connectivity : 0;
      this.nodeRibbonWeights[node] = visible ? this.decoded.ribbonWeight : 0;
    }

    for (let pairOffset = 0; pairOffset < snapshot.edges.length; pairOffset += 2) {
      const edge = pairOffset / 2;
      const startNode = snapshot.edges[pairOffset] ?? 0;
      const endNode = snapshot.edges[pairOffset + 1] ?? startNode;
      const startOffset = startNode * 3;
      const endOffset = endNode * 3;
      const writeOffset = pairOffset * 3;
      const importance = snapshot.topology.edgeImportance[edge] ?? 0;
      const lodVisible = importance >= threshold;
      const connectivity = lodVisible
        ? Math.min(this.nodeConnectivity[startNode] ?? 0, this.nodeConnectivity[endNode] ?? 0)
        : 0;
      this.buffers.edgeActivity[edge] = connectivity;

      const sx = this.buffers.nodePositions[startOffset] ?? 0;
      const sy = this.buffers.nodePositions[startOffset + 1] ?? 0;
      const sz = this.buffers.nodePositions[startOffset + 2] ?? 0;
      const ex = this.buffers.nodePositions[endOffset] ?? sx;
      const ey = this.buffers.nodePositions[endOffset + 1] ?? sy;
      const ez = this.buffers.nodePositions[endOffset + 2] ?? sz;
      const mx = (sx + ex) * 0.5;
      const my = (sy + ey) * 0.5;
      const mz = (sz + ez) * 0.5;
      const packedSx = mx + (sx - mx) * connectivity;
      const packedSy = my + (sy - my) * connectivity;
      const packedSz = mz + (sz - mz) * connectivity;
      const packedEx = mx + (ex - mx) * connectivity;
      const packedEy = my + (ey - my) * connectivity;
      const packedEz = mz + (ez - mz) * connectivity;
      this.buffers.edgePositions.set(
        [packedSx, packedSy, packedSz, packedEx, packedEy, packedEz],
        writeOffset,
      );

      const kind = snapshot.topology.edgeKind[edge] ?? EDGE_KIND.structure;
      const ribbonEligible = kind === EDGE_KIND.ribbon ||
        kind === EDGE_KIND.contour ||
        (kind === EDGE_KIND.branch && edge % 7 === 0);
      const dx = packedEx - packedSx;
      const dy = packedEy - packedSy;
      const dz = packedEz - packedSz;
      let nx = -dz;
      let ny = 0;
      let nz = dx;
      let normalLength = Math.hypot(nx, nz);
      if (normalLength < 0.0001) {
        nx = 0;
        ny = dz;
        nz = -dy;
        normalLength = Math.max(0.0001, Math.hypot(ny, nz));
      }
      const startWidth = ribbonEligible
        ? (0.008 + (this.nodeRibbonWeights[startNode] ?? 0) * 0.026) * connectivity
        : 0;
      const endWidth = ribbonEligible
        ? (0.008 + (this.nodeRibbonWeights[endNode] ?? 0) * 0.026) * connectivity
        : 0;
      nx /= normalLength;
      ny /= normalLength;
      nz /= normalLength;
      const ribbonOffset = edge * 12;
      this.buffers.ribbonPositions.set(
        [
          packedSx + nx * startWidth,
          packedSy + ny * startWidth,
          packedSz + nz * startWidth,
          packedSx - nx * startWidth,
          packedSy - ny * startWidth,
          packedSz - nz * startWidth,
          packedEx + nx * endWidth,
          packedEy + ny * endWidth,
          packedEz + nz * endWidth,
          packedEx - nx * endWidth,
          packedEy - ny * endWidth,
          packedEz - nz * endWidth,
        ],
        ribbonOffset,
      );
    }

    for (let index = 0; index < snapshot.topology.faces.length; index += 3) {
      const face = index / 3;
      const a = snapshot.topology.faces[index] ?? 0;
      const b = snapshot.topology.faces[index + 1] ?? a;
      const c = snapshot.topology.faces[index + 2] ?? a;
      const importance = snapshot.topology.faceImportance[face] ?? 0;
      const activity = importance >= threshold
        ? Math.min(
            this.nodeConnectivity[a] ?? 0,
            this.nodeConnectivity[b] ?? 0,
            this.nodeConnectivity[c] ?? 0,
          )
        : 0;
      this.buffers.faceActivity[face] = activity;
      const aOffset = a * 3;
      const bOffset = b * 3;
      const cOffset = c * 3;
      const ax = this.buffers.nodePositions[aOffset] ?? 0;
      const ay = this.buffers.nodePositions[aOffset + 1] ?? 0;
      const az = this.buffers.nodePositions[aOffset + 2] ?? 0;
      const bx = this.buffers.nodePositions[bOffset] ?? ax;
      const by = this.buffers.nodePositions[bOffset + 1] ?? ay;
      const bz = this.buffers.nodePositions[bOffset + 2] ?? az;
      const cx = this.buffers.nodePositions[cOffset] ?? ax;
      const cy = this.buffers.nodePositions[cOffset + 1] ?? ay;
      const cz = this.buffers.nodePositions[cOffset + 2] ?? az;
      const centerX = (ax + bx + cx) / 3;
      const centerY = (ay + by + cy) / 3;
      const centerZ = (az + bz + cz) / 3;
      const write = face * 9;
      this.buffers.facePositions.set(
        [
          centerX + (ax - centerX) * activity,
          centerY + (ay - centerY) * activity,
          centerZ + (az - centerZ) * activity,
          centerX + (bx - centerX) * activity,
          centerY + (by - centerY) * activity,
          centerZ + (bz - centerZ) * activity,
          centerX + (cx - centerX) * activity,
          centerY + (cy - centerY) * activity,
          centerZ + (cz - centerZ) * activity,
        ],
        write,
      );
    }

    return this.buffers;
  }
}
