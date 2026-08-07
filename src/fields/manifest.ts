import { EnvironmentFieldSampler } from './fieldSampler';
import { createFieldSample } from './types';
import {
  ENVIRONMENT_SCHEMA_VERSION,
  REQUIRED_LOOKS,
  type EnvironmentManifest,
  type SpawnVolume,
  type Vec3,
} from './types';

/** Minimum clearance between a spawned core and obstacle penetration. */
export const SPAWN_CLEARANCE_METERS = 0.2;

/** A spawn region may not overlap kill exposure above this value. */
export const SPAWN_MAX_KILL = 0.05;

/** A spawn region may not begin above this food exposure. */
export const SPAWN_MAX_FOOD = 0.1;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ManifestValidationOptions {
  /**
   * Known asset digests by asset ID. Any manifest digest that disagrees fails
   * validation; assets missing from the map are only checked for shape.
   */
  readonly assetChecksums?: Readonly<Record<string, string>>;
  /** Sample points per spawn region when checking the spawn contract. */
  readonly spawnSamples?: number;
}

export interface ManifestValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export class EnvironmentManifestError extends Error {
  constructor(
    readonly manifestId: string,
    readonly errors: readonly string[],
  ) {
    super(`Environment manifest "${manifestId}" is invalid:\n- ${errors.join('\n- ')}`);
    this.name = 'EnvironmentManifestError';
  }
}

function inRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function volumeCorners(volume: SpawnVolume): Vec3[] {
  if (volume.kind === 'sphere') {
    const [cx, cy, cz] = volume.center;
    const r = volume.radiusMeters;
    return [
      [cx, cy, cz],
      [cx - r, cy, cz],
      [cx + r, cy, cz],
      [cx, cy - r, cz],
      [cx, cy + r, cz],
      [cx, cy, cz - r],
      [cx, cy, cz + r],
    ];
  }
  const [cx, cy, cz] = volume.center;
  const [hx, hy, hz] = volume.halfExtents;
  const corners: Vec3[] = [[cx, cy, cz]];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push([cx + sx * hx, cy + sy * hy, cz + sz * hz]);
      }
    }
  }
  return corners;
}

/**
 * Strict manifest validation. Parsing never guesses: an unknown schema version,
 * an out-of-range channel, or a spawn region that violates the environment
 * contract fails visibly instead of degrading silently.
 */
export function validateEnvironmentManifest(
  manifest: EnvironmentManifest,
  options: ManifestValidationOptions = {},
): ManifestValidationResult {
  const errors: string[] = [];

  if (manifest.schemaVersion !== ENVIRONMENT_SCHEMA_VERSION) {
    errors.push(
      `Unsupported manifest version "${manifest.schemaVersion}"; expected "${ENVIRONMENT_SCHEMA_VERSION}".`,
    );
    // A version this runtime cannot read makes every other check meaningless.
    return { ok: false, errors };
  }
  if (!manifest.id) errors.push('Manifest is missing a stable environment ID.');
  if (manifest.units !== 'meters') errors.push(`Manifest units must be meters, found "${manifest.units}".`);
  if (manifest.coordinateSystem !== 'right-handed-y-up') {
    errors.push(`Manifest coordinate system must be right-handed-y-up, found "${manifest.coordinateSystem}".`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (!((manifest.bounds.max[axis] ?? 0) > (manifest.bounds.min[axis] ?? 0))) {
      errors.push(`Manifest bounds are empty or inverted on axis ${axis}.`);
    }
  }

  const seenIds = new Set<string>();
  const claimId = (id: string, kind: string): void => {
    if (!id) {
      errors.push(`A ${kind} is missing its stable ID.`);
      return;
    }
    if (seenIds.has(id)) errors.push(`Duplicate stable ID: ${id}`);
    seenIds.add(id);
  };

  for (const asset of manifest.assets) {
    claimId(asset.id, 'asset');
    if (!asset.uri) errors.push(`Asset ${asset.id} is missing a URI.`);
    if (!asset.sha256 || !SHA256_PATTERN.test(asset.sha256)) {
      errors.push(`Asset ${asset.id} is missing a valid sha256 checksum.`);
      continue;
    }
    const expected = options.assetChecksums?.[asset.id];
    if (expected && expected !== asset.sha256) {
      errors.push(`Asset ${asset.id} checksum does not match the known digest.`);
    }
  }

  for (const source of manifest.sources) {
    claimId(source.id, 'field source');
    const { effect, shelter, habitat, flow, auxiliaryRangeMeters } = source.channels;
    if (effect) {
      if (!inRange(effect.strength, -1, 1)) {
        errors.push(`Source ${source.id} effect strength ${effect.strength} is outside [-1, 1].`);
      }
      if (!(effect.rangeMeters > 0)) {
        errors.push(`Source ${source.id} effect range must be greater than zero.`);
      }
      if (effect.reserve) {
        if (!(effect.reserve.capacity > 0)) {
          errors.push(`Source ${source.id} reserve capacity must be greater than zero.`);
        }
        if (effect.reserve.regenerationPerSecond < 0) {
          errors.push(`Source ${source.id} reserve regeneration may not be negative.`);
        }
      }
    }
    if (shelter !== undefined && !inRange(shelter, 0, 1)) {
      errors.push(`Source ${source.id} shelter ${shelter} is outside [0, 1].`);
    }
    if (habitat) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = habitat[channel] ?? 0;
        if (!inRange(value, 0, 1)) {
          errors.push(`Source ${source.id} habitat channel ${channel} (${value}) is outside [0, 1].`);
        }
      }
    }
    if (flow && !Number.isFinite(Math.hypot(flow[0], flow[1], flow[2]))) {
      errors.push(`Source ${source.id} flow vector is not finite.`);
    }
    if (auxiliaryRangeMeters !== undefined && !(auxiliaryRangeMeters >= 0)) {
      errors.push(`Source ${source.id} auxiliary range may not be negative.`);
    }
    if (source.geometry.kind === 'capsule' && source.geometry.path.length === 0) {
      errors.push(`Source ${source.id} capsule path is empty.`);
    }
    if (source.geometry.kind === 'mesh' && source.geometry.triangles.length % 9 !== 0) {
      errors.push(`Source ${source.id} mesh triangles must be a multiple of nine floats.`);
    }
  }

  for (const region of manifest.spawnRegions) {
    claimId(region.id, 'spawn region');
    if (!(region.capacity > 0)) {
      errors.push(`Spawn region ${region.id} capacity must be greater than zero.`);
    }
  }
  for (const region of manifest.exclusionRegions ?? []) claimId(region.id, 'exclusion region');

  for (const preset of manifest.cameraPresets) {
    claimId(preset.id, 'camera preset');
    if (!preset.safeBounds) {
      errors.push(`Camera preset ${preset.id} omits its safe framing bounds.`);
    }
    if (preset.fallbackInput !== 'touch' && preset.fallbackInput !== 'pointer') {
      errors.push(`Camera preset ${preset.id} omits a usable fallback input.`);
    }
    if (!(preset.verticalFovDegrees > 0) || !(preset.farMeters > preset.nearMeters)) {
      errors.push(`Camera preset ${preset.id} has an unusable projection.`);
    }
  }

  for (const look of REQUIRED_LOOKS) {
    if (!manifest.looks.includes(look)) errors.push(`Manifest does not support the required look ${look}.`);
  }

  // Spawn placement is checked against the real sampler so an authoring mistake
  // fails at load rather than at the first tick.
  if (errors.length === 0) {
    const sampler = new EnvironmentFieldSampler(manifest);
    const sample = createFieldSample();
    for (const region of manifest.spawnRegions) {
      for (const point of volumeCorners(region.volume)) {
        sampler.sample(point[0], point[1], point[2], sample);
        if (sample.kill > SPAWN_MAX_KILL) {
          errors.push(
            `Spawn region ${region.id} overlaps kill exposure ${sample.kill.toFixed(3)} above ${SPAWN_MAX_KILL}.`,
          );
          break;
        }
        if (sample.obstacleDistance < SPAWN_CLEARANCE_METERS) {
          errors.push(
            `Spawn region ${region.id} is within ${SPAWN_CLEARANCE_METERS} m of obstacle penetration.`,
          );
          break;
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Validate a manifest and return a ready sampler, or throw a readable error. */
export function loadEnvironment(
  manifest: EnvironmentManifest,
  options: ManifestValidationOptions = {},
): EnvironmentFieldSampler {
  const result = validateEnvironmentManifest(manifest, options);
  if (!result.ok) throw new EnvironmentManifestError(manifest.id, result.errors);
  return new EnvironmentFieldSampler(manifest);
}
