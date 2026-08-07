import type { EnvironmentFieldSampler } from '../fields/fieldSampler';
import { loadEnvironment } from '../fields/manifest';
import { createFieldSample, FIELD_BATCH_STRIDE, type FieldSample } from '../fields/types';
import { HOME_MANIFEST } from '../environments/manifests/home';
import { ReferenceNcaKernel } from '../nca/referenceKernel';
import { counterRandom, SeededRandom } from './prng';
import { hashState } from './hashState';
import type { SimulationConfig, SimulationSnapshot } from './types';

const POSITION_COMPONENTS = 3;

/** Base idle drain per second before shelter protection. */
const IDLE_DRAIN_PER_SECOND = 0.012;

/** Maximum energy a cell can spend on movement in one tick. */
const MAX_MOTION_COST = 0.004;

/** Energy above which repair is permitted. */
const REPAIR_ENERGY_THRESHOLD = 0.35;

/** Kill exposure that suspends repair entirely. */
const REPAIR_KILL_CEILING = 0.05;

/** Energy drawn from a food source reserve per unit of energy gained. */
const RESERVE_DRAW_SCALE = 1;

/** Restitution used when a cell is pushed out of an obstacle. */
const OBSTACLE_RESTITUTION = 0.05;

/** Sampled clearance below which a cell is re-checked after integration. */
const OBSTACLE_RESOLVE_MARGIN = 0.08;

/** Separation kept after projecting a penetrating cell back out. */
const OBSTACLE_SKIN_METERS = 0.001;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

export class HeadlessSimulation {
  readonly channels: number;
  readonly nodeCount: number;
  readonly active: Uint8Array;
  readonly energy: Float32Array;
  readonly health: Float32Array;
  readonly edges: Uint32Array;

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
  private tickValue = 0;

  /** The environment field API; the only route from geometry to metabolism. */
  readonly fields: EnvironmentFieldSampler;
  private readonly fieldBatch: Float32Array;
  private readonly fieldContacts: Int32Array;
  private readonly obstacleSample: FieldSample = createFieldSample();

  constructor(readonly config: SimulationConfig) {
    this.channels = config.hiddenChannels ?? 24;
    this.fields = loadEnvironment(config.manifest ?? HOME_MANIFEST);
    this.nodeCount = config.tier.organisms * config.tier.slotsPerOrganism;
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
    this.edges = this.createEdges();
    this.kernel = new ReferenceNcaKernel(this.channels, config.learnedWidth ?? 12);
    this.latentDelta = new Float32Array(this.channels);
    this.acceleration = new Float32Array(3);
    this.fieldBatch = new Float32Array(this.nodeCount * FIELD_BATCH_STRIDE);
    this.fieldContacts = new Int32Array(this.nodeCount);
    this.initialize();
  }

  get tick(): number {
    return this.tickValue;
  }

  get snapshot(): SimulationSnapshot {
    return {
      tick: this.tickValue,
      active: this.active,
      positions: this.positions,
      previousPositions: this.previousPositions,
      velocities: this.velocities,
      energy: this.energy,
      health: this.health,
      edges: this.edges,
    };
  }

  step(dt = 1 / 30): void {
    this.previousPositions.set(this.positions);
    this.aggregateNeighbors();
    // Stage 1 of the tick: sample every field once, in stable source order.
    this.fields.sampleBatch(this.positions, this.nodeCount, this.fieldBatch, this.fieldContacts);

    const slots = this.config.tier.slotsPerOrganism;
    for (let cell = 0; cell < this.nodeCount; cell += 1) {
      const positionOffset = cell * POSITION_COMPONENTS;
      const latentOffset = cell * this.channels;
      const fieldOffset = cell * FIELD_BATCH_STRIDE;
      const organism = Math.floor(cell / slots);
      const localCell = cell % slots;

      if (this.active[cell] !== 1) {
        this.copyCell(cell);
        continue;
      }

      const food = this.fieldBatch[fieldOffset] ?? 0;
      const kill = this.fieldBatch[fieldOffset + 1] ?? 0;
      const obstacleDistance = this.fieldBatch[fieldOffset + 7] ?? 1;
      const shelter = this.fieldBatch[fieldOffset + 11] ?? 0;
      const eligible = counterRandom(this.config.seed, organism, localCell, this.tickValue) < 0.5;

      if (eligible) {
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

      // Metabolism: food and kill act independently and never cancel.
      const idleDrain = IDLE_DRAIN_PER_SECOND * (1 - 0.4 * shelter);
      const gain = 0.2 * food * dt;
      let motionCost = 0;
      for (let axis = 0; axis < POSITION_COMPONENTS; axis += 1) {
        motionCost += Math.abs(this.acceleration[axis] ?? 0);
      }
      motionCost = Math.min(MAX_MOTION_COST, motionCost * 0.0006);

      const previousEnergy = this.energy[cell] ?? 0;
      const energy = clamp01(previousEnergy + gain - idleDrain * dt - motionCost);
      this.energy[cell] = energy;

      // A finite source only feeds what it still holds.
      const contact = this.fieldContacts[cell] ?? -1;
      if (contact >= 0 && gain > 0) {
        this.fields.drawReserve(contact, gain * RESERVE_DRAW_SCALE);
      }

      const repairOk = energy > REPAIR_ENERGY_THRESHOLD && kill < REPAIR_KILL_CEILING;
      // P06 replaces this with the decoded repair gate; until then the gate is
      // still state-driven rather than constant.
      const repairGate = repairOk ? clamp01(0.5 + (this.latent[latentOffset] ?? 0) * 0.5) : 0;
      const health = clamp01((this.health[cell] ?? 0) - 0.35 * kill * dt + 0.08 * repairGate * dt);
      this.health[cell] = health;
      if (health <= 0) {
        // Death deactivates the slot; its stable ID stays available for regrowth.
        this.active[cell] = 0;
        this.copyCell(cell);
        continue;
      }

      for (let axis = 0; axis < POSITION_COMPONENTS; axis += 1) {
        const offset = positionOffset + axis;
        const position = this.positions[offset] ?? 0;
        const velocity = this.velocities[offset] ?? 0;
        const rest = this.restPositions[offset] ?? 0;
        const spring = (rest - position) * 0.75;
        const acceleration = (this.acceleration[axis] ?? 0) + spring;
        // Flow transports without touching energy or health.
        const flow = this.fieldBatch[fieldOffset + 15 + axis] ?? 0;
        const nextVelocity = (velocity + acceleration * dt) * 0.985 + flow * dt;
        this.nextVelocities[offset] = Math.min(1.5, Math.max(-1.5, nextVelocity));
        this.nextPositions[offset] = position + (this.nextVelocities[offset] ?? 0) * dt;
      }

      // Only cells near a surface can penetrate within one tick, so the
      // re-sample that resolves collision stays off the hot path.
      if (obstacleDistance < OBSTACLE_RESOLVE_MARGIN) this.resolveObstacle(positionOffset);
    }

    [this.positions, this.nextPositions] = [this.nextPositions, this.positions];
    [this.velocities, this.nextVelocities] = [this.nextVelocities, this.velocities];
    [this.latent, this.nextLatent] = [this.nextLatent, this.latent];
    this.fields.advance(dt);
    this.tickValue += 1;
  }

  /**
   * Project a penetrating cell back to the surface and remove its inward normal
   * velocity. Resolution never adds kinetic energy.
   */
  private resolveObstacle(positionOffset: number): void {
    const sample = this.fields.sample(
      this.nextPositions[positionOffset] ?? 0,
      this.nextPositions[positionOffset + 1] ?? 0,
      this.nextPositions[positionOffset + 2] ?? 0,
      this.obstacleSample,
    );
    if (sample.obstacleDistance >= 0) return;

    const normalX = sample.obstacleNormalX;
    const normalY = sample.obstacleNormalY;
    const normalZ = sample.obstacleNormalZ;
    const push = -sample.obstacleDistance + OBSTACLE_SKIN_METERS;
    this.nextPositions[positionOffset] = (this.nextPositions[positionOffset] ?? 0) + normalX * push;
    this.nextPositions[positionOffset + 1] =
      (this.nextPositions[positionOffset + 1] ?? 0) + normalY * push;
    this.nextPositions[positionOffset + 2] =
      (this.nextPositions[positionOffset + 2] ?? 0) + normalZ * push;

    const velocityX = this.nextVelocities[positionOffset] ?? 0;
    const velocityY = this.nextVelocities[positionOffset + 1] ?? 0;
    const velocityZ = this.nextVelocities[positionOffset + 2] ?? 0;
    const inward = velocityX * normalX + velocityY * normalY + velocityZ * normalZ;
    if (inward >= 0) return;
    const scale = (1 + OBSTACLE_RESTITUTION) * inward;
    this.nextVelocities[positionOffset] = velocityX - normalX * scale;
    this.nextVelocities[positionOffset + 1] = velocityY - normalY * scale;
    this.nextVelocities[positionOffset + 2] = velocityZ - normalZ * scale;
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
      [this.active, this.positions, this.velocities, this.latent, this.energy, this.health],
      this.tickValue,
    );
  }

  private initialize(): void {
    const random = new SeededRandom(this.config.seed);
    const slots = this.config.tier.slotsPerOrganism;
    const regionId = this.fields.spawnRegionIds[0];
    if (!regionId) {
      throw new Error(`Environment "${this.fields.environmentId}" declares no spawn region.`);
    }
    for (let organism = 0; organism < this.config.tier.organisms; organism += 1) {
      // Placement comes from the manifest spawn contract, not from a hard-coded
      // ring, so an unusable region fails visibly instead of drifting.
      const anchor = this.fields.placeSpawn(regionId, organism);
      if (!anchor) {
        throw new Error(
          `Spawn region "${regionId}" in "${this.fields.environmentId}" could not place organism ${organism} within the contract clearance, food, and kill limits.`,
        );
      }
      const [centerX, centerY, centerZ] = anchor;
      for (let localCell = 0; localCell < slots; localCell += 1) {
        const cell = organism * slots + localCell;
        const positionOffset = cell * POSITION_COMPONENTS;
        const latentOffset = cell * this.channels;
        const branch = Math.floor(localCell / 16);
        const along = localCell % 16;
        const phase = along * 0.42 + branch * 0.8 + organism;
        const radius = 0.08 + branch * 0.012;
        this.positions[positionOffset] = centerX + Math.cos(phase) * radius + branch * 0.025;
        this.positions[positionOffset + 1] = centerY + along * 0.055 + branch * 0.035;
        this.positions[positionOffset + 2] = centerZ + Math.sin(phase) * radius;
        this.active[cell] = 1;
        this.energy[cell] = 0.65;
        this.health[cell] = 1;
        for (let channel = 0; channel < this.channels; channel += 1) {
          this.latent[latentOffset + channel] = random.signed() * 0.18;
        }
      }
    }
    this.previousPositions.set(this.positions);
    this.nextPositions.set(this.positions);
    this.restPositions.set(this.positions);
    this.nextLatent.set(this.latent);
  }

  private aggregateNeighbors(): void {
    const slots = this.config.tier.slotsPerOrganism;
    for (let cell = 0; cell < this.nodeCount; cell += 1) {
      const localCell = cell % slots;
      const latentOffset = cell * this.channels;
      const previous = localCell > 0 ? cell - 1 : cell;
      const next = localCell + 1 < slots ? cell + 1 : cell;
      const previousOffset = previous * this.channels;
      const nextOffset = next * this.channels;
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.neighborLatent[latentOffset + channel] =
          ((this.latent[previousOffset + channel] ?? 0) + (this.latent[nextOffset + channel] ?? 0)) * 0.5;
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

  private createEdges(): Uint32Array {
    const edgePairs: number[] = [];
    const slots = this.config.tier.slotsPerOrganism;
    for (let organism = 0; organism < this.config.tier.organisms; organism += 1) {
      const start = organism * slots;
      for (let localCell = 1; localCell < slots; localCell += 1) {
        edgePairs.push(start + localCell - 1, start + localCell);
        if (localCell >= 16 && localCell % 16 === 0) {
          edgePairs.push(start + localCell - 16, start + localCell);
        }
      }
    }
    return Uint32Array.from(edgePairs);
  }
}
