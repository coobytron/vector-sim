import { ReferenceNcaKernel } from '../nca/referenceKernel';
import { createMorphologyTopology, NO_PARENT } from '../organisms/morphology';
import type { MorphologyTopology } from '../organisms/types';
import { counterRandom, SeededRandom } from './prng';
import { hashState } from './hashState';
import type { SimulationConfig, SimulationSnapshot } from './types';

const POSITION_COMPONENTS = 3;
const MAX_GRAPH_DEGREE = 8;
const NO_NEIGHBOR = 0xffff_ffff;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function radialField(x: number, y: number, z: number, cx: number, cy: number, cz: number): number {
  const distance = Math.hypot(x - cx, y - cy, z - cz);
  return clamp01(1 - distance / 1.15);
}

export class HeadlessSimulation {
  readonly channels: number;
  readonly nodeCount: number;
  readonly active: Uint8Array;
  readonly energy: Float32Array;
  readonly health: Float32Array;
  readonly previousHealth: Float32Array;
  readonly edges: Uint32Array;
  readonly topology: MorphologyTopology;

  private positions: Float32Array;
  private previousPositions: Float32Array;
  private nextPositions: Float32Array;
  private velocities: Float32Array;
  private nextVelocities: Float32Array;
  private latent: Float32Array;
  private neighborLatent: Float32Array;
  private nextLatent: Float32Array;
  private readonly restPositions: Float32Array;
  private readonly kernel: ReferenceNcaKernel;
  private readonly latentDelta: Float32Array;
  private readonly acceleration: Float32Array;
  private readonly adjacency: Uint32Array;
  private readonly degree: Uint8Array;
  private tickValue = 0;

  constructor(readonly config: SimulationConfig) {
    this.channels = config.hiddenChannels ?? 24;
    this.nodeCount = config.tier.organisms * config.tier.slotsPerOrganism;
    this.topology = createMorphologyTopology(config.tier, config.seed);
    this.positions = new Float32Array(this.nodeCount * POSITION_COMPONENTS);
    this.previousPositions = new Float32Array(this.positions.length);
    this.nextPositions = new Float32Array(this.positions.length);
    this.velocities = new Float32Array(this.positions.length);
    this.nextVelocities = new Float32Array(this.positions.length);
    this.restPositions = new Float32Array(this.positions.length);
    this.latent = new Float32Array(this.nodeCount * this.channels);
    this.neighborLatent = new Float32Array(this.latent.length);
    this.nextLatent = new Float32Array(this.latent.length);
    this.active = new Uint8Array(this.nodeCount);
    this.energy = new Float32Array(this.nodeCount);
    this.health = new Float32Array(this.nodeCount);
    this.previousHealth = new Float32Array(this.nodeCount);
    this.edges = this.topology.edges;
    this.adjacency = new Uint32Array(this.nodeCount * MAX_GRAPH_DEGREE);
    this.adjacency.fill(NO_NEIGHBOR);
    this.degree = new Uint8Array(this.nodeCount);
    this.buildAdjacency();
    this.kernel = new ReferenceNcaKernel(this.channels, config.learnedWidth ?? 12);
    this.latentDelta = new Float32Array(this.channels);
    this.acceleration = new Float32Array(3);
    this.initialize();
  }

  get tick(): number {
    return this.tickValue;
  }

  get snapshot(): SimulationSnapshot {
    return {
      tick: this.tickValue,
      channels: this.channels,
      ncaMode: this.config.ncaMode ?? 'live',
      active: this.active,
      positions: this.positions,
      previousPositions: this.previousPositions,
      latent: this.latent,
      energy: this.energy,
      health: this.health,
      previousHealth: this.previousHealth,
      edges: this.edges,
      topology: this.topology,
    };
  }

  step(dt = 1 / 30): void {
    this.previousPositions.set(this.positions);
    this.previousHealth.set(this.health);
    this.aggregateNeighbors();

    const slots = this.config.tier.slotsPerOrganism;
    for (let cell = 0; cell < this.nodeCount; cell += 1) {
      const positionOffset = cell * POSITION_COMPONENTS;
      const latentOffset = cell * this.channels;
      const organism = Math.floor(cell / slots);
      const localCell = cell % slots;

      if (this.active[cell] !== 1) {
        this.copyCell(cell);
        continue;
      }

      const x = this.positions[positionOffset] ?? 0;
      const y = this.positions[positionOffset + 1] ?? 0;
      const z = this.positions[positionOffset + 2] ?? 0;
      const food = radialField(x, y, z, 1.7, 0.75, 0.4);
      const kill = radialField(x, y, z, -1.7, 1.0, -0.4);
      const eligible = counterRandom(this.config.seed, organism, localCell, this.tickValue) < 0.5;

      if (eligible && (this.config.ncaMode ?? 'live') === 'live') {
        this.kernel.evaluate(
          this.latent,
          latentOffset,
          this.neighborLatent,
          latentOffset,
          this.energy[cell] ?? 0,
          this.health[cell] ?? 0,
          food,
          kill,
          { latentDelta: this.latentDelta, acceleration: this.acceleration },
        );
      } else {
        this.latentDelta.fill(0);
        this.acceleration.fill(0);
      }

      for (let channel = 0; channel < this.channels; channel += 1) {
        this.nextLatent[latentOffset + channel] = clampSigned(
          (this.latent[latentOffset + channel] ?? 0) + (this.latentDelta[channel] ?? 0),
        );
      }

      const idleDrain = 0.012;
      this.energy[cell] = clamp01((this.energy[cell] ?? 0) + 0.2 * food * dt - idleDrain * dt);
      const repairGate = clamp01(((this.latent[latentOffset + 7] ?? 0) + 1) * 0.5);
      const repair = (this.energy[cell] ?? 0) > 0.35 && kill < 0.05
        ? 0.08 * repairGate * dt
        : 0;
      this.health[cell] = clamp01((this.health[cell] ?? 0) - 0.35 * kill * dt + repair);

      for (let axis = 0; axis < POSITION_COMPONENTS; axis += 1) {
        const offset = positionOffset + axis;
        const position = this.positions[offset] ?? 0;
        const velocity = this.velocities[offset] ?? 0;
        const rest = this.restPositions[offset] ?? 0;
        const spring = (rest - position) * 0.75;
        const flow = axis === 0 ? 0.025 * Math.sin(this.tickValue * 0.018 + organism) : 0;
        const acceleration = (this.acceleration[axis] ?? 0) + spring + flow;
        const nextVelocity = (velocity + acceleration * dt) * 0.985;
        this.nextVelocities[offset] = Math.min(1.5, Math.max(-1.5, nextVelocity));
        this.nextPositions[offset] = position + (this.nextVelocities[offset] ?? 0) * dt;
      }
    }

    [this.positions, this.nextPositions] = [this.nextPositions, this.positions];
    [this.velocities, this.nextVelocities] = [this.nextVelocities, this.velocities];
    [this.latent, this.nextLatent] = [this.nextLatent, this.latent];
    this.tickValue += 1;
  }

  interpolate(alpha: number, target: Float32Array): Float32Array {
    if (target.length !== this.positions.length) {
      throw new RangeError(`Expected interpolation target length ${this.positions.length}, received ${target.length}`);
    }
    const amount = Math.min(1, Math.max(0, alpha));
    for (let index = 0; index < target.length; index += 1) {
      const previous = this.previousPositions[index] ?? 0;
      target[index] = previous + ((this.positions[index] ?? 0) - previous) * amount;
    }
    return target;
  }

  stateHash(): string {
    return hashState(
      [
        this.active,
        this.positions,
        this.velocities,
        this.latent,
        this.energy,
        this.health,
        this.edges,
        this.topology.nodeParent,
      ],
      this.tickValue,
    );
  }

  private initialize(): void {
    const random = new SeededRandom(this.config.seed);
    this.positions.set(this.topology.restPositions);
    for (let cell = 0; cell < this.nodeCount; cell += 1) {
      const latentOffset = cell * this.channels;
      this.active[cell] = 1;
      this.energy[cell] = 0.65;
      this.health[cell] = 1;
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.latent[latentOffset + channel] = random.signed() * 0.18;
      }
    }
    this.previousPositions.set(this.positions);
    this.nextPositions.set(this.positions);
    this.restPositions.set(this.positions);
    this.previousHealth.set(this.health);
    this.nextLatent.set(this.latent);
  }

  private aggregateNeighbors(): void {
    for (let cell = 0; cell < this.nodeCount; cell += 1) {
      const latentOffset = cell * this.channels;
      const degree = this.degree[cell] ?? 0;
      for (let channel = 0; channel < this.channels; channel += 1) {
        let total = 0;
        for (let neighborIndex = 0; neighborIndex < degree; neighborIndex += 1) {
          const neighbor = this.adjacency[cell * MAX_GRAPH_DEGREE + neighborIndex] ?? cell;
          total += this.latent[neighbor * this.channels + channel] ?? 0;
        }
        this.neighborLatent[latentOffset + channel] = degree > 0
          ? total / degree
          : this.latent[latentOffset + channel] ?? 0;
      }
    }
  }

  private copyCell(cell: number): void {
    const positionOffset = cell * POSITION_COMPONENTS;
    const latentOffset = cell * this.channels;
    for (let axis = 0; axis < POSITION_COMPONENTS; axis += 1) {
      this.nextPositions[positionOffset + axis] = this.positions[positionOffset + axis] ?? 0;
      this.nextVelocities[positionOffset + axis] = this.velocities[positionOffset + axis] ?? 0;
    }
    for (let channel = 0; channel < this.channels; channel += 1) {
      this.nextLatent[latentOffset + channel] = this.latent[latentOffset + channel] ?? 0;
    }
  }

  private buildAdjacency(): void {
    for (let index = 0; index < this.edges.length; index += 2) {
      const start = this.edges[index] ?? NO_PARENT;
      const end = this.edges[index + 1] ?? NO_PARENT;
      if (start === NO_PARENT || end === NO_PARENT) continue;
      this.addNeighbor(start, end);
      this.addNeighbor(end, start);
    }
  }

  private addNeighbor(cell: number, neighbor: number): void {
    const degree = this.degree[cell] ?? 0;
    if (degree >= MAX_GRAPH_DEGREE) {
      throw new RangeError(`Morphology node ${cell} exceeds maximum graph degree ${MAX_GRAPH_DEGREE}.`);
    }
    this.adjacency[cell * MAX_GRAPH_DEGREE + degree] = neighbor;
    this.degree[cell] = degree + 1;
  }
}
