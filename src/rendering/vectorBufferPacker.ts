import type { SimulationSnapshot } from '../simulation/types';

export interface VectorBuffers {
  nodePositions: Float32Array;
  nodeScales: Float32Array;
  edgePositions: Float32Array;
  ribbonPositions: Float32Array;
  ribbonCount: number;
}

export class VectorBufferPacker {
  readonly buffers: VectorBuffers;
  private readonly interpolation: Float32Array;

  constructor(snapshot: SimulationSnapshot, private readonly ribbonStride = 12) {
    const edgeCount = snapshot.edges.length / 2;
    const ribbonCount = Math.ceil(edgeCount / ribbonStride);
    this.interpolation = new Float32Array(snapshot.positions.length);
    this.buffers = {
      nodePositions: new Float32Array(snapshot.positions.length),
      nodeScales: new Float32Array(snapshot.active.length),
      edgePositions: new Float32Array(snapshot.edges.length * 3),
      ribbonPositions: new Float32Array(ribbonCount * 4 * 3),
      ribbonCount,
    };
  }

  update(snapshot: SimulationSnapshot, alpha: number): VectorBuffers {
    const amount = Math.min(1, Math.max(0, alpha));
    for (let index = 0; index < this.interpolation.length; index += 1) {
      const previous = snapshot.previousPositions[index] ?? 0;
      this.interpolation[index] =
        previous + ((snapshot.positions[index] ?? 0) - previous) * amount;
      this.buffers.nodePositions[index] = this.interpolation[index] ?? 0;
    }

    for (let node = 0; node < snapshot.active.length; node += 1) {
      const health = snapshot.health[node] ?? 0;
      const energy = snapshot.energy[node] ?? 0;
      this.buffers.nodeScales[node] =
        snapshot.active[node] === 1 ? 0.65 + health * 0.55 + energy * 0.18 : 0;
    }

    for (let edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex += 2) {
      const startNode = snapshot.edges[edgeIndex] ?? 0;
      const endNode = snapshot.edges[edgeIndex + 1] ?? 0;
      const startOffset = startNode * 3;
      const endOffset = endNode * 3;
      const writeOffset = edgeIndex * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        this.buffers.edgePositions[writeOffset + axis] = this.interpolation[startOffset + axis] ?? 0;
        this.buffers.edgePositions[writeOffset + 3 + axis] = this.interpolation[endOffset + axis] ?? 0;
      }
    }

    let ribbon = 0;
    const sourceStep = this.ribbonStride * 2;
    for (let edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex += sourceStep) {
      const startNode = snapshot.edges[edgeIndex] ?? 0;
      const endNode = snapshot.edges[edgeIndex + 1] ?? startNode;
      const startOffset = startNode * 3;
      const endOffset = endNode * 3;
      const sx = this.interpolation[startOffset] ?? 0;
      const sy = this.interpolation[startOffset + 1] ?? 0;
      const sz = this.interpolation[startOffset + 2] ?? 0;
      const ex = this.interpolation[endOffset] ?? 0;
      const ey = this.interpolation[endOffset + 1] ?? 0;
      const ez = this.interpolation[endOffset + 2] ?? 0;
      const dx = ex - sx;
      const dy = ey - sy;
      const dz = ez - sz;
      let nx = -dz;
      let ny = 0;
      let nz = dx;
      let length = Math.hypot(nx, nz);
      if (length < 0.0001) {
        nx = 0;
        ny = dz;
        nz = -dy;
        length = Math.max(0.0001, Math.hypot(ny, nz));
      }
      const width = 0.018 + (snapshot.energy[startNode] ?? 0) * 0.012;
      nx = (nx / length) * width;
      ny = (ny / length) * width;
      nz = (nz / length) * width;

      const writeOffset = ribbon * 12;
      this.buffers.ribbonPositions.set(
        [
          sx + nx,
          sy + ny,
          sz + nz,
          sx - nx,
          sy - ny,
          sz - nz,
          ex + nx,
          ey + ny,
          ez + nz,
          ex - nx,
          ey - ny,
          ez - nz,
        ],
        writeOffset,
      );
      ribbon += 1;
    }

    return this.buffers;
  }
}

