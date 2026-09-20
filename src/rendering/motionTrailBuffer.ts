function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface MotionTrailBuffers {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly visibleSegmentCounts: Uint16Array;
}

/**
 * Fixed-capacity motion history for organism centroids.
 *
 * The backing arrays are allocated once and rewritten in place. New history is
 * sampled at most once per simulation tick, so rendering the same tick multiple
 * times cannot create extra trail points.
 */
export class MotionTrailBuffer {
  readonly buffers: MotionTrailBuffers;

  private readonly history: Float32Array;
  private readonly historyLength: Uint16Array;
  private readonly writeIndex: Uint16Array;
  private readonly centroids: Float32Array;
  private readonly centroidCounts: Uint16Array;
  private lastTick = -1;

  constructor(
    readonly organismCount: number,
    readonly samplesPerOrganism = 24,
  ) {
    if (!Number.isInteger(organismCount) || organismCount <= 0) {
      throw new RangeError('organismCount must be a positive integer');
    }
    if (!Number.isInteger(samplesPerOrganism) || samplesPerOrganism < 2) {
      throw new RangeError('samplesPerOrganism must be an integer >= 2');
    }

    const segmentCount = organismCount * (samplesPerOrganism - 1);
    this.history = new Float32Array(organismCount * samplesPerOrganism * 3);
    this.historyLength = new Uint16Array(organismCount);
    this.writeIndex = new Uint16Array(organismCount);
    this.centroids = new Float32Array(organismCount * 3);
    this.centroidCounts = new Uint16Array(organismCount);
    this.buffers = {
      positions: new Float32Array(segmentCount * 2 * 3),
      colors: new Float32Array(segmentCount * 2 * 3),
      visibleSegmentCounts: new Uint16Array(organismCount),
    };
    this.buffers.colors.fill(1);
  }

  update(
    tick: number,
    nodePositions: Float32Array,
    nodeOrganism: Uint16Array,
    nodeScales: Float32Array,
    persistences: Float32Array,
  ): MotionTrailBuffers {
    this.centroids.fill(0);
    this.centroidCounts.fill(0);

    const nodeCount = Math.min(nodeOrganism.length, nodeScales.length, Math.floor(nodePositions.length / 3));
    for (let node = 0; node < nodeCount; node += 1) {
      if ((nodeScales[node] ?? 0) <= 0) continue;
      const organism = nodeOrganism[node] ?? 0;
      if (organism >= this.organismCount) continue;
      const read = node * 3;
      const write = organism * 3;
      this.centroids[write] = (this.centroids[write] ?? 0) + (nodePositions[read] ?? 0);
      this.centroids[write + 1] =
        (this.centroids[write + 1] ?? 0) + (nodePositions[read + 1] ?? 0);
      this.centroids[write + 2] =
        (this.centroids[write + 2] ?? 0) + (nodePositions[read + 2] ?? 0);
      this.centroidCounts[organism] = (this.centroidCounts[organism] ?? 0) + 1;
    }

    for (let organism = 0; organism < this.organismCount; organism += 1) {
      const count = this.centroidCounts[organism] ?? 0;
      if (count === 0) continue;
      const offset = organism * 3;
      this.centroids[offset] = (this.centroids[offset] ?? 0) / count;
      this.centroids[offset + 1] = (this.centroids[offset + 1] ?? 0) / count;
      this.centroids[offset + 2] = (this.centroids[offset + 2] ?? 0) / count;
    }

    if (tick !== this.lastTick) {
      for (let organism = 0; organism < this.organismCount; organism += 1) {
        if ((this.centroidCounts[organism] ?? 0) === 0) continue;
        const slot = this.writeIndex[organism] ?? 0;
        const historyOffset = (organism * this.samplesPerOrganism + slot) * 3;
        const centroidOffset = organism * 3;
        this.history[historyOffset] = this.centroids[centroidOffset] ?? 0;
        this.history[historyOffset + 1] = this.centroids[centroidOffset + 1] ?? 0;
        this.history[historyOffset + 2] = this.centroids[centroidOffset + 2] ?? 0;
        this.writeIndex[organism] = (slot + 1) % this.samplesPerOrganism;
        this.historyLength[organism] = Math.min(
          this.samplesPerOrganism,
          (this.historyLength[organism] ?? 0) + 1,
        );
      }
      this.lastTick = tick;
    }

    for (let organism = 0; organism < this.organismCount; organism += 1) {
      const persistence = clamp01(persistences[organism] ?? 0);
      const available = Math.max(0, (this.historyLength[organism] ?? 0) - 1);
      const visible = Math.min(
        available,
        Math.round((this.samplesPerOrganism - 1) * persistence),
      );
      this.buffers.visibleSegmentCounts[organism] = visible;

      const newest = ((this.writeIndex[organism] ?? 0) - 1 + this.samplesPerOrganism) %
        this.samplesPerOrganism;

      for (let segment = 0; segment < this.samplesPerOrganism - 1; segment += 1) {
        const output = (organism * (this.samplesPerOrganism - 1) + segment) * 6;
        const newestHistory = (
          organism * this.samplesPerOrganism +
          ((newest - segment + this.samplesPerOrganism) % this.samplesPerOrganism)
        ) * 3;
        const olderHistory = (
          organism * this.samplesPerOrganism +
          ((newest - segment - 1 + this.samplesPerOrganism) % this.samplesPerOrganism)
        ) * 3;

        const fractured = persistence < 0.45 && ((segment + organism * 2) % 3 === 1);
        if (segment >= visible || fractured) {
          const x = this.history[newestHistory] ?? 0;
          const y = this.history[newestHistory + 1] ?? 0;
          const z = this.history[newestHistory + 2] ?? 0;
          this.buffers.positions.set([x, y, z, x, y, z], output);
          this.buffers.colors.fill(1, output, output + 6);
          continue;
        }

        this.buffers.positions.set(
          [
            this.history[newestHistory] ?? 0,
            this.history[newestHistory + 1] ?? 0,
            this.history[newestHistory + 2] ?? 0,
            this.history[olderHistory] ?? 0,
            this.history[olderHistory + 1] ?? 0,
            this.history[olderHistory + 2] ?? 0,
          ],
          output,
        );

        const age = visible <= 1 ? 0 : segment / (visible - 1);
        const newestTone = clamp01(0.7 + age * 0.22 + (1 - persistence) * 0.05);
        const olderTone = clamp01(newestTone + 0.035);
        this.buffers.colors.set(
          [newestTone, newestTone, newestTone, olderTone, olderTone, olderTone],
          output,
        );
      }
    }

    return this.buffers;
  }
}
