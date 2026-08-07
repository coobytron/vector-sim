import { createSurfaceQuery, evaluateGeometry, geometryBounds, translateGeometry } from './shapes';
import type { SurfaceQuery } from './shapes';
import { FieldSpatialIndex, type SourceBounds } from './spatialIndex';
import {
  createFieldSample,
  FIELD_BATCH_STRIDE,
  type EnvironmentManifest,
  type FieldGeometry,
  type FieldSample,
  type FieldSourceDescriptor,
  type SpawnVolume,
  type Vec3,
} from './types';

/** Central-difference step for the numeric gradient reference. */
export const GRADIENT_STEP_METERS = 0.01;

/** Gradient magnitude, in `1/m`, that normalizes to a reported 1.0. */
export const GRADIENT_MAGNITUDE_SCALE = 20;

/** Obstacle signed distance is reported in meters clamped to this range. */
export const OBSTACLE_DISTANCE_CLAMP_METERS = 1;

/** Flow magnitude clamp for the MVP. */
export const MAX_FLOW_METERS_PER_SECOND = 1;

const DEFAULT_CELL_SIZE_METERS = 0.5;

export interface FieldSourceRuntime {
  readonly id: string;
  readonly geometryId?: string;
  readonly tags: readonly string[];
  geometry: FieldGeometry;
  /** Signed authored strength in `[-1, 1]`. */
  strength: number;
  rangeMeters: number;
  /** Zero capacity means an unlimited authored source. */
  capacity: number;
  reserve: number;
  regenerationPerSecond: number;
  obstacle: boolean;
  shelter: number;
  habitat: Vec3;
  flow: Vec3;
  /** Zero means the shelter/habitat/flow channels use volume containment. */
  auxiliaryRangeMeters: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Smootherstep falloff from the environment contract, in float32. */
export function effectFalloff(distanceMeters: number, rangeMeters: number): number {
  if (!(rangeMeters > 0)) return 0;
  const u = Math.fround(clamp(1 - Math.max(0, distanceMeters) / rangeMeters, 0, 1));
  return Math.fround(u * u * u * (u * (u * 6 - 15) + 10));
}

/**
 * Derivative of the falloff with respect to distance, `dw/dd` in `1/m`. Inside
 * a volume and beyond the range the falloff is flat, so the slope is zero.
 */
export function effectFalloffSlope(distanceMeters: number, rangeMeters: number): number {
  if (!(rangeMeters > 0) || distanceMeters <= 0 || distanceMeters >= rangeMeters) return 0;
  const u = clamp(1 - distanceMeters / rangeMeters, 0, 1);
  // w(u) = 6u⁵ - 15u⁴ + 10u³ → w'(u) = 30u²(u-1)²; du/dd = -1/r.
  return Math.fround((-30 * u * u * (u - 1) * (u - 1)) / rangeMeters);
}

/** Shared normalization for both the analytic and numeric gradient paths. */
function writeGradient(out: FieldSample, dx: number, dy: number, dz: number): void {
  const magnitude = Math.hypot(dx, dy, dz);
  if (magnitude <= 1e-8) {
    out.gradientX = 0;
    out.gradientY = 0;
    out.gradientZ = 0;
    out.gradientMagnitude = 0;
    return;
  }
  out.gradientX = Math.fround(dx / magnitude);
  out.gradientY = Math.fround(dy / magnitude);
  out.gradientZ = Math.fround(dz / magnitude);
  out.gradientMagnitude = clamp(Math.fround(magnitude / GRADIENT_MAGNITUDE_SCALE), 0, 1);
}

function runtimeFromDescriptor(descriptor: FieldSourceDescriptor): FieldSourceRuntime {
  const effect = descriptor.channels.effect;
  const capacity = effect?.reserve?.capacity ?? 0;
  return {
    id: descriptor.id,
    geometryId: descriptor.geometryId,
    tags: descriptor.tags ?? [],
    geometry: descriptor.geometry,
    strength: effect?.strength ?? 0,
    rangeMeters: effect?.rangeMeters ?? 0,
    capacity,
    reserve: capacity,
    regenerationPerSecond: effect?.reserve?.regenerationPerSecond ?? 0,
    obstacle: descriptor.channels.obstacle === true,
    shelter: descriptor.channels.shelter ?? 0,
    habitat: descriptor.channels.habitat ?? [0, 0, 0],
    flow: descriptor.channels.flow ?? [0, 0, 0],
    auxiliaryRangeMeters: descriptor.channels.auxiliaryRangeMeters ?? 0,
  };
}

/**
 * Weight for the shelter, habitat, and flow channels. With no authored range
 * these channels are containment-based: full value inside the volume, nothing
 * outside it.
 */
function auxiliaryWeight(distanceMeters: number, rangeMeters: number): number {
  if (rangeMeters > 0) return effectFalloff(distanceMeters, rangeMeters);
  return distanceMeters <= 0 ? 1 : 0;
}

function influenceBounds(source: FieldSourceRuntime): SourceBounds {
  const bounds = geometryBounds(source.geometry);
  // Obstacles must be findable from the full clamped SDF range even when they
  // carry no effect channel.
  const carriesAuxiliary =
    source.shelter > 0 ||
    source.habitat.some((value) => value !== 0) ||
    source.flow.some((value) => value !== 0);
  const margin = Math.max(
    source.strength === 0 ? 0 : source.rangeMeters,
    source.obstacle ? OBSTACLE_DISTANCE_CLAMP_METERS : 0,
    carriesAuxiliary ? source.auxiliaryRangeMeters : 0,
  );
  return {
    min: [bounds.min[0] - margin, bounds.min[1] - margin, bounds.min[2] - margin],
    max: [bounds.max[0] + margin, bounds.max[1] + margin, bounds.max[2] + margin],
  };
}

function insideVolume(volume: SpawnVolume, x: number, y: number, z: number): boolean {
  if (volume.kind === 'sphere') {
    return (
      Math.hypot(x - volume.center[0], y - volume.center[1], z - volume.center[2]) <=
      volume.radiusMeters
    );
  }
  return (
    Math.abs(x - volume.center[0]) <= volume.halfExtents[0] &&
    Math.abs(y - volume.center[1]) <= volume.halfExtents[1] &&
    Math.abs(z - volume.center[2]) <= volume.halfExtents[2]
  );
}

/**
 * The one query API every environment uses.
 *
 * A wall, window, outlet, table, tree, drain, current, or invisible region all
 * reach organisms through this sampler. Nothing here knows which environment it
 * belongs to, and no organism code knows which source it touched.
 */
export class EnvironmentFieldSampler {
  readonly environmentId: string;
  readonly sources: FieldSourceRuntime[];

  private index: FieldSpatialIndex;
  private readonly bounds: SourceBounds;
  private readonly cellSize: number;
  private readonly byId = new Map<string, number>();
  private readonly candidates: number[] = [];
  private candidateCellKey = -1;
  private readonly gradientCandidates: number[] = [];
  private readonly query: SurfaceQuery = createSurfaceQuery();
  private readonly gradientQuery: SurfaceQuery = createSurfaceQuery();
  private readonly scratch: FieldSample = createFieldSample();
  private readonly exclusions: readonly { id: string; volume: SpawnVolume }[];
  private readonly spawnRegions: EnvironmentManifest['spawnRegions'];

  constructor(manifest: EnvironmentManifest, cellSizeMeters = DEFAULT_CELL_SIZE_METERS) {
    this.environmentId = manifest.id;
    this.bounds = { min: manifest.bounds.min, max: manifest.bounds.max };
    this.cellSize = cellSizeMeters;
    this.exclusions = (manifest.exclusionRegions ?? []).map((region) => ({
      id: region.id,
      volume: region.volume,
    }));
    this.spawnRegions = manifest.spawnRegions;
    // Stable source-ID order is the evaluation order. Declaration order in the
    // manifest never reaches a sampled value.
    this.sources = [...manifest.sources]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map(runtimeFromDescriptor);
    this.index = this.buildIndex();
    this.reindexIds();
  }

  private buildIndex(): FieldSpatialIndex {
    return new FieldSpatialIndex(this.bounds, this.cellSize, this.sources.map(influenceBounds));
  }

  private reindexIds(): void {
    this.byId.clear();
    for (let index = 0; index < this.sources.length; index += 1) {
      this.byId.set((this.sources[index] as FieldSourceRuntime).id, index);
    }
  }

  /** Effective signed strength after depletion. */
  private effectiveStrength(source: FieldSourceRuntime): number {
    if (source.capacity <= 0) return source.strength;
    return Math.fround(source.strength * clamp(source.reserve / source.capacity, 0, 1));
  }

  /** Spawn region IDs in manifest order. */
  get spawnRegionIds(): readonly string[] {
    return this.spawnRegions.map((region) => region.id);
  }

  indexOf(sourceId: string): number {
    return this.byId.get(sourceId) ?? -1;
  }

  sourceById(sourceId: string): FieldSourceRuntime | undefined {
    const index = this.indexOf(sourceId);
    return index < 0 ? undefined : this.sources[index];
  }

  /** Sample every channel at one world position. */
  sample(x: number, y: number, z: number, out: FieldSample = this.scratch): FieldSample {
    // Cells of one organism cluster inside a handful of grid cells, so batches
    // reuse the candidate list instead of re-querying and re-sorting per cell.
    const cellKey = this.index.cellKeyFor(x, y, z);
    if (cellKey !== this.candidateCellKey) {
      this.index.query(x, y, z, this.candidates);
      this.candidateCellKey = cellKey;
    }
    const candidates = this.candidates;

    let foodComplement = 1;
    let killComplement = 1;
    let strongestFood = 0;
    let strongestKill = 0;
    let contactIndex = -1;
    let contactSign = 0;
    let contactX = 0;
    let contactY = 0;
    let contactZ = 0;
    let contactNormalX = 0;
    let contactNormalY = 1;
    let contactNormalZ = 0;

    let obstacleDistance = OBSTACLE_DISTANCE_CLAMP_METERS;
    let obstacleNormalX = 0;
    let obstacleNormalY = 1;
    let obstacleNormalZ = 0;

    // Analytic gradient accumulators. Each source contributes
    // (∂aᵢ/∂d · nᵢ) / (1 - aᵢ); the saturating-union factor is applied once the
    // full product is known.
    let foodDerivativeX = 0;
    let foodDerivativeY = 0;
    let foodDerivativeZ = 0;
    let killDerivativeX = 0;
    let killDerivativeY = 0;
    let killDerivativeZ = 0;

    let shelterComplement = 1;
    let habitatWeight = 0;
    let habitatA = 0;
    let habitatB = 0;
    let habitatC = 0;
    let flowX = 0;
    let flowY = 0;
    let flowZ = 0;

    for (const sourceIndex of candidates) {
      const source = this.sources[sourceIndex] as FieldSourceRuntime;
      evaluateGeometry(source.geometry, x, y, z, this.query);
      const distance = this.query.distance;

      if (source.obstacle && distance < obstacleDistance) {
        // Ties keep the earlier (lower) source ID because the comparison is
        // strict, which makes the winner independent of declaration order.
        obstacleDistance = distance;
        obstacleNormalX = this.query.normalX;
        obstacleNormalY = this.query.normalY;
        obstacleNormalZ = this.query.normalZ;
      }

      const strength = this.effectiveStrength(source);
      if (strength !== 0 && source.rangeMeters > 0) {
        const amount = Math.fround(
          clamp(Math.abs(strength) * effectFalloff(distance, source.rangeMeters), 0, 1),
        );
        if (amount > 0) {
          // Compared before the running maxima update so an exact tie keeps the
          // lower source ID.
          const dominant = Math.max(strongestFood, strongestKill);
          if (strength > 0) {
            foodComplement = Math.fround(foodComplement * (1 - amount));
            if (amount > strongestFood) strongestFood = amount;
          } else {
            killComplement = Math.fround(killComplement * (1 - amount));
            if (amount > strongestKill) strongestKill = amount;
          }
          if (amount > dominant) {
            contactIndex = sourceIndex;
            contactSign = strength > 0 ? 1 : -1;
            contactX = this.query.pointX;
            contactY = this.query.pointY;
            contactZ = this.query.pointZ;
            contactNormalX = this.query.normalX;
            contactNormalY = this.query.normalY;
            contactNormalZ = this.query.normalZ;
          }

          const slope = effectFalloffSlope(distance, source.rangeMeters);
          if (slope !== 0 && amount < 1) {
            // d grows along the outward normal, so ∂aᵢ/∂x = |s| · w'(d) · nₓ.
            const term = (Math.abs(strength) * slope) / (1 - amount);
            if (strength > 0) {
              foodDerivativeX += term * this.query.normalX;
              foodDerivativeY += term * this.query.normalY;
              foodDerivativeZ += term * this.query.normalZ;
            } else {
              killDerivativeX += term * this.query.normalX;
              killDerivativeY += term * this.query.normalY;
              killDerivativeZ += term * this.query.normalZ;
            }
          }
        }
      }

      const auxiliary = auxiliaryWeight(distance, source.auxiliaryRangeMeters);
      if (auxiliary > 0) {
        if (source.shelter > 0) {
          const amount = Math.fround(clamp(source.shelter * auxiliary, 0, 1));
          shelterComplement = Math.fround(shelterComplement * (1 - amount));
        }

        const habitat = source.habitat;
        if (habitat[0] !== 0 || habitat[1] !== 0 || habitat[2] !== 0) {
          habitatWeight = Math.fround(habitatWeight + auxiliary);
          habitatA = Math.fround(habitatA + habitat[0] * auxiliary);
          habitatB = Math.fround(habitatB + habitat[1] * auxiliary);
          habitatC = Math.fround(habitatC + habitat[2] * auxiliary);
        }

        const flow = source.flow;
        if (flow[0] !== 0 || flow[1] !== 0 || flow[2] !== 0) {
          flowX = Math.fround(flowX + flow[0] * auxiliary);
          flowY = Math.fround(flowY + flow[1] * auxiliary);
          flowZ = Math.fround(flowZ + flow[2] * auxiliary);
        }
      }
    }

    const food = Math.fround(1 - foodComplement);
    const kill = Math.fround(1 - killComplement);
    out.food = food;
    out.kill = kill;
    out.effect = clamp(Math.fround(food - kill), -1, 1);

    out.obstacleDistance = clamp(
      obstacleDistance,
      -OBSTACLE_DISTANCE_CLAMP_METERS,
      OBSTACLE_DISTANCE_CLAMP_METERS,
    );
    out.obstacleNormalX = obstacleNormalX;
    out.obstacleNormalY = obstacleNormalY;
    out.obstacleNormalZ = obstacleNormalZ;

    out.shelter = clamp(Math.fround(1 - shelterComplement), 0, 1);

    if (habitatWeight > 0) {
      out.habitatA = clamp(Math.fround(habitatA / habitatWeight), 0, 1);
      out.habitatB = clamp(Math.fround(habitatB / habitatWeight), 0, 1);
      out.habitatC = clamp(Math.fround(habitatC / habitatWeight), 0, 1);
    } else {
      out.habitatA = 0;
      out.habitatB = 0;
      out.habitatC = 0;
    }

    const flowMagnitude = Math.hypot(flowX, flowY, flowZ);
    if (flowMagnitude > MAX_FLOW_METERS_PER_SECOND) {
      const scale = MAX_FLOW_METERS_PER_SECOND / flowMagnitude;
      flowX = Math.fround(flowX * scale);
      flowY = Math.fround(flowY * scale);
      flowZ = Math.fround(flowZ * scale);
    }
    out.flowX = flowX;
    out.flowY = flowY;
    out.flowZ = flowZ;

    out.contactSourceIndex = contactIndex;
    out.contactSign = contactSign;
    out.contactX = contactX;
    out.contactY = contactY;
    out.contactZ = contactZ;
    out.contactNormalX = contactNormalX;
    out.contactNormalY = contactNormalY;
    out.contactNormalZ = contactNormalZ;

    // ∂F/∂x = (1-F)·Σ terms, and likewise for K; E = F - K.
    writeGradient(
      out,
      foodComplement * foodDerivativeX - killComplement * killDerivativeX,
      foodComplement * foodDerivativeY - killComplement * killDerivativeY,
      foodComplement * foodDerivativeZ - killComplement * killDerivativeZ,
    );
    return out;
  }

  /** Signed net effect only; used by the gradient and by cheap probes. */
  sampleEffect(x: number, y: number, z: number): number {
    const candidates = this.index.query(x, y, z, this.gradientCandidates);
    let foodComplement = 1;
    let killComplement = 1;
    for (const sourceIndex of candidates) {
      const source = this.sources[sourceIndex] as FieldSourceRuntime;
      const strength = this.effectiveStrength(source);
      if (strength === 0 || !(source.rangeMeters > 0)) continue;
      evaluateGeometry(source.geometry, x, y, z, this.gradientQuery);
      const amount = Math.fround(
        clamp(Math.abs(strength) * effectFalloff(this.gradientQuery.distance, source.rangeMeters), 0, 1),
      );
      if (amount <= 0) continue;
      if (strength > 0) foodComplement = Math.fround(foodComplement * (1 - amount));
      else killComplement = Math.fround(killComplement * (1 - amount));
    }
    return clamp(Math.fround(Math.fround(1 - foodComplement) - Math.fround(1 - killComplement)), -1, 1);
  }

  /**
   * Central-difference gradient at 1 cm. The runtime path is analytic; this is
   * the documented fallback and the reference the analytic path is tested
   * against.
   */
  sampleEffectGradientNumeric(x: number, y: number, z: number, out: FieldSample): FieldSample {
    const step = GRADIENT_STEP_METERS;
    writeGradient(
      out,
      (this.sampleEffect(x + step, y, z) - this.sampleEffect(x - step, y, z)) / (2 * step),
      (this.sampleEffect(x, y + step, z) - this.sampleEffect(x, y - step, z)) / (2 * step),
      (this.sampleEffect(x, y, z + step) - this.sampleEffect(x, y, z - step)) / (2 * step),
    );
    return out;
  }

  /**
   * Sample many cell positions into a packed float32 buffer whose stride
   * matches the environment rows of the perception contract.
   */
  sampleBatch(
    positions: Float32Array,
    count: number,
    out: Float32Array,
    contactSources?: Int32Array,
  ): Float32Array {
    const required = count * FIELD_BATCH_STRIDE;
    if (out.length < required) {
      throw new RangeError(`Field batch buffer needs ${required} floats, received ${out.length}`);
    }
    for (let cell = 0; cell < count; cell += 1) {
      const read = cell * 3;
      const sample = this.sample(
        positions[read] ?? 0,
        positions[read + 1] ?? 0,
        positions[read + 2] ?? 0,
        this.scratch,
      );
      if (contactSources) contactSources[cell] = sample.contactSourceIndex;
      const write = cell * FIELD_BATCH_STRIDE;
      out[write] = sample.food;
      out[write + 1] = sample.kill;
      out[write + 2] = sample.effect;
      out[write + 3] = sample.gradientX;
      out[write + 4] = sample.gradientY;
      out[write + 5] = sample.gradientZ;
      out[write + 6] = sample.gradientMagnitude;
      out[write + 7] = sample.obstacleDistance;
      out[write + 8] = sample.obstacleNormalX;
      out[write + 9] = sample.obstacleNormalY;
      out[write + 10] = sample.obstacleNormalZ;
      out[write + 11] = sample.shelter;
      out[write + 12] = sample.habitatA;
      out[write + 13] = sample.habitatB;
      out[write + 14] = sample.habitatC;
      out[write + 15] = sample.flowX;
      out[write + 16] = sample.flowY;
      out[write + 17] = sample.flowZ;
    }
    return out;
  }

  /** Draw from a finite reserve. Returns the amount actually withdrawn. */
  drawReserve(sourceIndex: number, amount: number): number {
    const source = this.sources[sourceIndex];
    if (!source || source.capacity <= 0 || amount <= 0) return amount > 0 ? amount : 0;
    const drawn = Math.min(source.reserve, amount);
    source.reserve = Math.fround(source.reserve - drawn);
    return drawn;
  }

  /** Regenerate finite reserves. Call once per simulation tick. */
  advance(dt: number): void {
    for (const source of this.sources) {
      if (source.capacity <= 0 || source.regenerationPerSecond === 0) continue;
      source.reserve = clamp(
        Math.fround(source.reserve + source.regenerationPerSecond * dt),
        0,
        source.capacity,
      );
    }
  }

  /**
   * Flip or retune a source at runtime. Reversing the sign turns a feeding
   * surface into a hazard with no change anywhere in agent code.
   */
  setStrength(sourceId: string, strength: number): void {
    const index = this.indexOf(sourceId);
    const source = this.sources[index];
    if (!source) throw new RangeError(`Unknown field source: ${sourceId}`);
    source.strength = clamp(strength, -1, 1);
    // A source that was silent and now carries strength changes its influence
    // bounds, so its bucket membership has to follow.
    this.index.update(index, influenceBounds(source));
    this.candidateCellKey = -1;
  }

  setRange(sourceId: string, rangeMeters: number): void {
    const index = this.indexOf(sourceId);
    const source = this.sources[index];
    if (!source) throw new RangeError(`Unknown field source: ${sourceId}`);
    if (!(rangeMeters > 0)) {
      throw new RangeError(`Field range must be positive, received ${rangeMeters}`);
    }
    source.rangeMeters = rangeMeters;
    this.index.update(index, influenceBounds(source));
    this.candidateCellKey = -1;
  }

  /** Move a source without rebuilding the spatial index. */
  moveSource(sourceId: string, delta: Vec3): void {
    const index = this.indexOf(sourceId);
    const source = this.sources[index];
    if (!source) throw new RangeError(`Unknown field source: ${sourceId}`);
    source.geometry = translateGeometry(source.geometry, delta);
    this.index.update(index, influenceBounds(source));
    this.candidateCellKey = -1;
  }

  /** Painting hook for #14: add an authored source at runtime. */
  addSource(descriptor: FieldSourceDescriptor): void {
    if (this.byId.has(descriptor.id)) {
      throw new RangeError(`Duplicate field source ID: ${descriptor.id}`);
    }
    const runtime = runtimeFromDescriptor(descriptor);
    let insertAt = this.sources.length;
    for (let index = 0; index < this.sources.length; index += 1) {
      if ((this.sources[index] as FieldSourceRuntime).id > runtime.id) {
        insertAt = index;
        break;
      }
    }
    this.sources.splice(insertAt, 0, runtime);
    this.index = this.buildIndex();
    this.reindexIds();
    this.candidateCellKey = -1;
  }

  removeSource(sourceId: string): void {
    const index = this.indexOf(sourceId);
    if (index < 0) throw new RangeError(`Unknown field source: ${sourceId}`);
    this.sources.splice(index, 1);
    this.index = this.buildIndex();
    this.reindexIds();
    this.candidateCellKey = -1;
  }

  isExcluded(x: number, y: number, z: number): boolean {
    for (const region of this.exclusions) {
      if (insideVolume(region.volume, x, y, z)) return true;
    }
    return false;
  }

  /**
   * Deterministic spawn placement from a low-discrepancy sequence. Returns
   * `undefined` when the region cannot satisfy the contract so callers report a
   * visible authoring error instead of moving somewhere unrelated.
   */
  placeSpawn(
    regionId: string,
    ordinal: number,
    options: {
      minimumClearanceMeters?: number;
      maximumFood?: number;
      maximumKill?: number;
      attempts?: number;
    } = {},
  ): Vec3 | undefined {
    const region = this.spawnRegions.find((candidate) => candidate.id === regionId);
    if (!region) return undefined;
    const clearance = options.minimumClearanceMeters ?? 0.2;
    const maximumFood = options.maximumFood ?? 0.1;
    const maximumKill = options.maximumKill ?? 0.05;
    const attempts = options.attempts ?? 32;
    const sample = createFieldSample();

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const n = ordinal * attempts + attempt + 1;
      // Halton sequence, bases 2/3/5 — deterministic and seed-stable.
      const u = halton(n, 2);
      const v = halton(n, 3);
      const w = halton(n, 5);
      const point = pointInVolume(region.volume, u, v, w);
      if (this.isExcluded(point[0], point[1], point[2])) continue;
      this.sample(point[0], point[1], point[2], sample);
      if (sample.kill > maximumKill) continue;
      if (sample.food > maximumFood) continue;
      if (sample.obstacleDistance < clearance) continue;
      return point;
    }
    return undefined;
  }
}

function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1;
  let current = index;
  while (current > 0) {
    fraction /= base;
    result += fraction * (current % base);
    current = Math.floor(current / base);
  }
  return result;
}

function pointInVolume(volume: SpawnVolume, u: number, v: number, w: number): Vec3 {
  if (volume.kind === 'sphere') {
    const radius = volume.radiusMeters * Math.cbrt(u);
    const theta = v * Math.PI * 2;
    const cosPhi = w * 2 - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    return [
      volume.center[0] + radius * sinPhi * Math.cos(theta),
      volume.center[1] + radius * cosPhi,
      volume.center[2] + radius * sinPhi * Math.sin(theta),
    ];
  }
  return [
    volume.center[0] + (u * 2 - 1) * volume.halfExtents[0],
    volume.center[1] + (v * 2 - 1) * volume.halfExtents[1],
    volume.center[2] + (w * 2 - 1) * volume.halfExtents[2],
  ];
}
