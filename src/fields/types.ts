/**
 * Environment field contract types.
 *
 * These types are the only way an environment tells the simulation how a piece
 * of geometry influences organisms. Runtime code never infers food or kill
 * behaviour from mesh names, colours, materials, or file paths — see
 * `docs/ENVIRONMENT-CONTRACT.md`.
 */

export type Vec3 = readonly [number, number, number];

export type FieldGeometry =
  | { readonly kind: 'point'; readonly position: Vec3 }
  | { readonly kind: 'sphere'; readonly center: Vec3; readonly radiusMeters: number }
  | {
      readonly kind: 'box';
      readonly center: Vec3;
      readonly halfExtents: Vec3;
      readonly yawRadians?: number;
    }
  | { readonly kind: 'capsule'; readonly path: readonly Vec3[]; readonly radiusMeters: number }
  | {
      readonly kind: 'plane';
      readonly center: Vec3;
      readonly normal: Vec3;
      readonly halfExtents: readonly [number, number];
    }
  | { readonly kind: 'mesh'; readonly triangles: readonly number[] };

/** Depletion and regeneration for a finite food or hazard reserve. */
export interface EffectReserve {
  /** Total drawable amount before the source reads as exhausted. */
  readonly capacity: number;
  /** Reserve restored per second, clamped to `capacity`. */
  readonly regenerationPerSecond: number;
}

export interface EffectChannel {
  /** Signed strength in `[-1, 1]`: positive feeds, negative kills. */
  readonly strength: number;
  /** Influence range in meters, strictly greater than zero. */
  readonly rangeMeters: number;
  readonly reserve?: EffectReserve;
}

/**
 * Independent channels owned by one source. A food threshold may also be an
 * obstacle; a sheltered alcove may also carry a habitat value. Channels never
 * imply each other.
 */
export interface FieldChannels {
  readonly effect?: EffectChannel;
  /** Collision and navigation only; no metabolic effect. */
  readonly obstacle?: boolean;
  /** Idle-drain protection in `[0, 1]`. */
  readonly shelter?: number;
  /** Three authored phenotype-conditioning values, each `[0, 1]`. */
  readonly habitat?: Vec3;
  /** Transport vector in `m/s`; magnitude is clamped to 1 m/s at combination. */
  readonly flow?: Vec3;
  /**
   * Falloff range in meters for the shelter, habitat, and flow channels. When
   * omitted these channels use volume containment: full value inside the
   * authored volume and nothing outside it.
   */
  readonly auxiliaryRangeMeters?: number;
}

export interface FieldSourceDescriptor {
  /** Stable ID; also the deterministic evaluation order key. */
  readonly id: string;
  /** Stable ID of the visible geometry this source is bound to, when any. */
  readonly geometryId?: string;
  readonly geometry: FieldGeometry;
  readonly channels: FieldChannels;
  /** Free-form authoring tags. Tags never change the signed energy contract. */
  readonly tags?: readonly string[];
}

export type SpawnVolume =
  | { readonly kind: 'box'; readonly center: Vec3; readonly halfExtents: Vec3 }
  | { readonly kind: 'sphere'; readonly center: Vec3; readonly radiusMeters: number };

export interface SpawnRegionDescriptor {
  readonly id: string;
  readonly geometryId?: string;
  readonly volume: SpawnVolume;
  readonly capacity: number;
}

export interface ExclusionRegionDescriptor {
  readonly id: string;
  readonly volume: SpawnVolume;
}

export interface CameraPresetDescriptor {
  readonly id: string;
  readonly target: Vec3;
  readonly position: Vec3;
  readonly verticalFovDegrees: number;
  readonly nearMeters: number;
  readonly farMeters: number;
  /** Safe framing bounds; required by the environment contract. */
  readonly safeBounds: { readonly min: Vec3; readonly max: Vec3 };
  /** Input fallback that must survive a permission failure. */
  readonly fallbackInput: 'touch' | 'pointer';
}

export interface EnvironmentAssetDescriptor {
  readonly id: string;
  readonly uri: string;
  readonly sha256: string;
}

export const ENVIRONMENT_SCHEMA_VERSION = 'environment.v1';

export const REQUIRED_LOOKS = ['porcelain-spectrum', 'technical-wire', 'ghost-volume'] as const;

export interface EnvironmentManifest {
  readonly schemaVersion: string;
  readonly id: string;
  readonly displayName: string;
  readonly units: 'meters';
  readonly coordinateSystem: 'right-handed-y-up';
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly assets: readonly EnvironmentAssetDescriptor[];
  readonly sources: readonly FieldSourceDescriptor[];
  readonly spawnRegions: readonly SpawnRegionDescriptor[];
  readonly exclusionRegions?: readonly ExclusionRegionDescriptor[];
  readonly cameraPresets: readonly CameraPresetDescriptor[];
  readonly looks: readonly string[];
  readonly qualityTiers: readonly string[];
}

/**
 * One sampled field observation. Field values are separate channels: `food` and
 * `kill` never cancel, and `effect` exists only as learned directional context.
 */
export interface FieldSample {
  food: number;
  kill: number;
  effect: number;
  gradientX: number;
  gradientY: number;
  gradientZ: number;
  gradientMagnitude: number;
  /** Signed distance in meters, clamped to ±1; negative means penetrating. */
  obstacleDistance: number;
  obstacleNormalX: number;
  obstacleNormalY: number;
  obstacleNormalZ: number;
  shelter: number;
  habitatA: number;
  habitatB: number;
  habitatC: number;
  flowX: number;
  flowY: number;
  flowZ: number;
  /** Index of the strongest effect contributor, or -1 when none applies. */
  contactSourceIndex: number;
  /** Sign of the strongest effect contributor: +1 food, -1 kill, 0 none. */
  contactSign: number;
  contactX: number;
  contactY: number;
  contactZ: number;
  contactNormalX: number;
  contactNormalY: number;
  contactNormalZ: number;
}

export function createFieldSample(): FieldSample {
  return {
    food: 0,
    kill: 0,
    effect: 0,
    gradientX: 0,
    gradientY: 0,
    gradientZ: 0,
    gradientMagnitude: 0,
    obstacleDistance: 1,
    obstacleNormalX: 0,
    obstacleNormalY: 1,
    obstacleNormalZ: 0,
    shelter: 0,
    habitatA: 0,
    habitatB: 0,
    habitatC: 0,
    flowX: 0,
    flowY: 0,
    flowZ: 0,
    contactSourceIndex: -1,
    contactSign: 0,
    contactX: 0,
    contactY: 0,
    contactZ: 0,
    contactNormalX: 0,
    contactNormalY: 1,
    contactNormalZ: 0,
  };
}

/**
 * Batch layout handed to the NCA. The order matches the environment rows of the
 * perception table in `docs/SIMULATION-CONTRACT.md`.
 */
export const FIELD_BATCH_STRIDE = 18;

export const FIELD_BATCH_CHANNELS = [
  'food',
  'kill',
  'effect',
  'gradientX',
  'gradientY',
  'gradientZ',
  'gradientMagnitude',
  'obstacleDistance',
  'obstacleNormalX',
  'obstacleNormalY',
  'obstacleNormalZ',
  'shelter',
  'habitatA',
  'habitatB',
  'habitatC',
  'flowX',
  'flowY',
  'flowZ',
] as const;
